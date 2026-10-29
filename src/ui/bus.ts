// Fire-and-forget channels from the engine client / panels to the map.
import type { Frame } from '../engine/protocol';

type Fn<T> = (v: T) => void;
function channel<T>() {
  const ls = new Set<Fn<T>>();
  return {
    on(f: Fn<T>) { ls.add(f); return () => { ls.delete(f); }; },
    emit(v: T) { ls.forEach((f) => f(v)); },
  };
}

/** Every engine frame (also replays after a seek). `interpMs` = expected time to the next frame. */
export const frameBus = channel<{ frame: Frame; interpMs: number }>();
/** Clear map run layers (new run / reset). */
export const resetBus = channel<void>();
export const flyBus = channel<{ lon: number; lat: number; zoom?: number }>();
export const fitBus = channel<[number, number, number, number]>();
