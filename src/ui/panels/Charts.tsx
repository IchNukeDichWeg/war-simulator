import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import '../../styles/results.css';
import { ensureContrast } from '../color';
import { fmt } from '../format';
import { useTheme } from '../theme';

interface Props {
  title: string;
  /** Y-axis label with its unit, e.g. "personnel" or "% of theater land". */
  unit: string;
  days: number[];
  series: [number[], number[]];
  names: [string, string];
  colors: [string, string];
  version: number;
  /** Values are 0..1 fractions, shown as percent on a fixed 0-100% axis. */
  percent?: boolean;
  /** Charts with the same key share the hover cursor (hover day N on one, read it on all). */
  sync?: string;
  height?: number;
}

/** Side colours made legible on the current panel background (3:1, WCAG graphics minimum). */
export function useLegibleColors(colors: [string, string]): [string, string] {
  const t = useTheme();
  return [ensureContrast(colors[0], t.panel), ensureContrast(colors[1], t.panel)];
}

/**
 * One uPlot chart, two series (one per side), x = simulated day. Side B is dashed so the
 * sides stay distinguishable without colour. Hovering shows that day's values in the header;
 * otherwise the header shows the latest day. Colours come from the theme tokens and are
 * re-read when the theme changes (the canvas does not see CSS custom properties).
 */
export function SideChart({ title, unit, days, series, names, colors, version, percent, sync, height = 120 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const theme = useTheme();
  const [c0, c1] = useLegibleColors(colors);
  const [idx, setIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const el = box.current;
    const val = (_u: uPlot, v: number | null) => (v == null ? '-' : percent ? `${Math.round(v * 100)}%` : fmt(v));
    const axis = {
      stroke: theme.muted,
      grid: { stroke: theme.line, width: 1 },
      ticks: { stroke: theme.line, width: 1, size: 4 },
      font: '10px system-ui, sans-serif',
      labelFont: '10px system-ui, sans-serif',
      labelSize: 12,
      labelGap: 0,
    };
    const opts: uPlot.Options = {
      width: Math.max(200, el.clientWidth),
      height,
      legend: { show: false },
      cursor: { points: { size: 6 }, drag: { x: false, y: false }, ...(sync ? { sync: { key: sync } } : {}) },
      scales: { x: { time: false }, y: percent ? { range: [0, 1] } : { range: (_u, lo, hi) => [Math.min(0, lo), hi > 0 ? hi * 1.05 : 1] } },
      axes: [
        { ...axis, label: 'day', size: 20 },
        { ...axis, label: unit, size: 40, values: (_u, vals) => vals.map((v) => (percent ? `${Math.round(v * 100)}%` : fmt(v, 2))) },
      ],
      series: [
        { label: 'day' },
        { label: names[0], stroke: c0, width: 1.75, value: val },
        { label: names[1], stroke: c1, width: 1.75, dash: [6, 3], value: val },
      ],
      hooks: {
        setCursor: [(u) => setIdx(u.cursor.idx ?? null)],
        // a dot on each line's latest point marks "now" (the current simulated day)
        draw: [(u) => {
          const n = u.data[0].length - 1;
          if (n < 0) return;
          const ctx = u.ctx;
          const x = u.valToPos(u.data[0][n] as number, 'x', true);
          ([1, 2] as const).forEach((s) => {
            const v = u.data[s][n];
            if (v == null) return;
            ctx.beginPath();
            ctx.fillStyle = s === 1 ? c0 : c1;
            ctx.arc(x, u.valToPos(v as number, 'y', true), 3 * uPlot.pxRatio, 0, Math.PI * 2);
            ctx.fill();
          });
        }],
      },
    };
    plot.current = new uPlot(opts, [days, series[0], series[1]], el);
    const ro = new ResizeObserver(() => plot.current?.setSize({ width: Math.max(200, el.clientWidth), height }));
    ro.observe(el);
    return () => { ro.disconnect(); plot.current?.destroy(); plot.current = null; };
    // rebuild only when identity-relevant props or the theme change; data goes through setData
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c0, c1, names[0], names[1], percent, unit, sync, height, theme]);

  useEffect(() => {
    plot.current?.setData([days, series[0], series[1]]);
  }, [version, days, series]);

  const last = days.length - 1;
  const i = idx != null && idx >= 0 && idx <= last ? idx : last;
  const show = (v: number | undefined) => (v == null ? '-' : percent ? `${Math.round(v * 100)}%` : fmt(v));
  return (
    <figure className="rp-chart">
      <figcaption className="rp-chart-title">
        <span>{title}</span>
        {i >= 0 && (
          <span className="rp-chart-last" aria-live="off">
            <span className="rp-muted">{idx != null && idx !== last ? `day ${days[i]}` : 'now'}</span>{' '}
            <span style={{ color: c0 }} title={names[0]}>{show(series[0][i])}</span>
            {' | '}
            <span style={{ color: c1 }} title={names[1]}>{show(series[1][i])}</span>
          </span>
        )}
      </figcaption>
      <div ref={box} className="rp-chart-plot" />
    </figure>
  );
}

/** Legend for a stack of side charts: solid line = first side, dashed = second. */
export function SideLegend({ names, colors }: { names: [string, string]; colors: [string, string] }) {
  const [c0, c1] = useLegibleColors(colors);
  return (
    <div className="rp-legend">
      <span><svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={c0} strokeWidth="2" /></svg> {names[0]}</span>
      <span><svg width="22" height="8" aria-hidden><line x1="0" y1="4" x2="22" y2="4" stroke={c1} strokeWidth="2" strokeDasharray="6 3" /></svg> {names[1]}</span>
    </div>
  );
}
