// Pieces shared by the run panel views (RunPanel.tsx, MonteCarloView.tsx).
import { useState } from 'react';
import type { Reason } from '../../engine/protocol';
import '../../styles/results.css';
import { GradeBadge } from '../Grade';
import { useStore } from '../store';

/** Side names (of the running run, else of the scenario) and the scenario's side colours. */
export function useSides() {
  const sc = useStore((s) => s.scenario);
  const runNames = useStore((s) => s.run.sideNames);
  const status = useStore((s) => s.run.status);
  const names: [string, string] = status === 'idle' ? [sc.sides[0].name, sc.sides[1].name] : runNames;
  const colors: [string, string] = [sc.sides[0].color, sc.sides[1].color];
  return { names, colors };
}

export const ModelTag = () => <span className="model-tag" title="Simulation output, not sourced data">model output <GradeBadge g="M" /></span>;

/** Ranked reasons from the engine's explain step; weights are shares of the explanation. */
export function Reasons({ reasons, names, colors, top }: { reasons: Reason[]; names: [string, string]; colors: [string, string]; top?: number }) {
  const [all, setAll] = useState(false);
  const shown = top && !all ? reasons.slice(0, top) : reasons;
  return (
    <>
      <ol className="rp-reasons">
        {shown.map((r, i) => (
          <li key={i}>
            <div className="rp-reason-head">
              <span className="rp-reason-rank">{i + 1}</span>
              <b>{r.factor}</b>
              <span className="rp-muted small">favoured <span style={{ color: colors[r.side] }}>{names[r.side]}</span></span>
              <span className="rp-reason-w" title="Share of the explanation across all factors (factors under 1% are not listed)">{Math.round(r.weight * 100)}%</span>
            </div>
            <div className="rp-reason-bar"><div style={{ width: `${Math.max(1, Math.round(r.weight * 100))}%`, background: colors[r.side] }} /></div>
            <div className="small rp-reason-detail">{r.detail}</div>
          </li>
        ))}
      </ol>
      {top != null && reasons.length > top && (
        <button className="rp-textbtn" onClick={() => setAll(!all)}>{all ? `Show the top ${top} only` : `Show all ${reasons.length} factors`}</button>
      )}
    </>
  );
}
