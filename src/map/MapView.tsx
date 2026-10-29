import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapController } from './controller';
import { fitBus, flyBus, frameBus, resetBus } from '../ui/bus';
import { setScenario, store, toast } from '../ui/store';

export function MapView() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const c = new MapController(ref.current);
    (window as unknown as { __map: unknown }).__map = c;
    const sync = () => {
      const s = store.get();
      c.update({ data: s.data, scenario: s.scenario, layers: s.layers, mapMode: s.mapMode, theater: s.run.theater });
    };
    c.onBBox = (bbox) => {
      setScenario((sc) => ({ ...sc, theater: { name: 'Custom', bbox } }));
      store.set({ mapMode: { kind: 'none' } });
      toast(`Theater set to ${bbox.join(', ')}`);
    };
    c.onStart = (side, lat, lon) => {
      setScenario((sc) => {
        const sides = [...sc.sides] as typeof sc.sides;
        sides[side] = { ...sides[side], startPositions: [...(sides[side].startPositions ?? []), { lat, lon }] };
        return { ...sc, sides };
      });
    };
    sync();
    const offs = [
      store.subscribe(sync),
      frameBus.on(({ frame, interpMs }) => c.applyFrame(frame, interpMs)),
      resetBus.on(() => c.reset()),
      flyBus.on(({ lon, lat, zoom }) => c.flyTo(lon, lat, zoom)),
      fitBus.on((b) => c.fit(b)),
    ];
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') store.set({ mapMode: { kind: 'none' } }); };
    window.addEventListener('keydown', onKey);
    return () => { offs.forEach((o) => o()); window.removeEventListener('keydown', onKey); c.destroy(); };
  }, []);
  return <div ref={ref} className="map" />;
}
