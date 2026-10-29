import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { fmt } from '../format';

interface Props {
  title: string;
  days: number[];
  series: [number[], number[]];
  names: [string, string];
  colors: [string, string];
  version: number;
  percent?: boolean;
}

/** One live uPlot chart, two series (one per side), x = simulated day. */
export function SideChart({ title, days, series, names, colors, version, percent }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const el = box.current;
    const val = (_u: uPlot, v: number | null) => (v == null ? '-' : percent ? `${Math.round(v * 100)}%` : fmt(v));
    const opts: uPlot.Options = {
      width: Math.max(200, el.clientWidth),
      height: 110,
      legend: { show: false },
      cursor: { points: { size: 5 } },
      scales: { x: { time: false }, y: percent ? { range: [0, 1] } : { auto: true } },
      axes: [
        { stroke: '#8b949e', grid: { stroke: '#21262d', width: 1 }, ticks: { stroke: '#30363d' }, size: 22, font: '10px system-ui' },
        { stroke: '#8b949e', grid: { stroke: '#21262d', width: 1 }, ticks: { stroke: '#30363d' }, size: 44, font: '10px system-ui',
          values: (_u, vals) => vals.map((v) => (percent ? `${Math.round(v * 100)}%` : fmt(v, 2))) },
      ],
      series: [
        { label: 'day' },
        { label: names[0], stroke: colors[0], width: 1.6, value: val },
        { label: names[1], stroke: colors[1], width: 1.6, value: val },
      ],
    };
    plot.current = new uPlot(opts, [days, series[0], series[1]], el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: Math.max(200, el.clientWidth), height: 110 }));
    ro.observe(el);
    return () => { ro.disconnect(); plot.current?.destroy(); plot.current = null; };
    // rebuild only when identity-relevant props change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors[0], colors[1], names[0], names[1], percent]);

  useEffect(() => {
    plot.current?.setData([days, series[0], series[1]]);
  }, [version, days, series]);

  const last = days.length - 1;
  return (
    <div className="chart">
      <div className="chart-title">
        <span>{title}</span>
        <span className="chart-last">
          {last >= 0 && <>
            <span style={{ color: colors[0] }}>{percent ? `${Math.round(series[0][last] * 100)}%` : fmt(series[0][last])}</span>
            {' / '}
            <span style={{ color: colors[1] }}>{percent ? `${Math.round(series[1][last] * 100)}%` : fmt(series[1][last])}</span>
          </>}
        </span>
      </div>
      <div ref={box} />
    </div>
  );
}
