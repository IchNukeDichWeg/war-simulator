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

const SHARE_TITLE = 'Share of the explanation across all factors (factors under 1% are not listed)';

/** Everyday wording for the engine's factor names (src/engine/explain.ts); the engine's name
 *  stays in the tooltip. A factor missing here shows under its engine name. */
const PLAIN_FACTOR: Record<string, string> = {
  'Tech gap': 'Better weapons and technology',
  'Command and doctrine': 'Better leadership and tactics',
  'Terrain and fortification': 'Terrain and defences',
  'Air support': 'Air support in battle',
  'Numbers': 'More troops',
  'Supply': 'Better supplied troops',
  'Naval control': 'Control of the sea',
  'Air superiority': 'Control of the air',
  'Morale collapses': 'Enemy units broke and fled more often',
  'Disease and attrition': 'Fewer losses to disease and hardship',
  'Nuclear strikes': 'Nuclear strikes',
};

/** Ranked reasons from the engine's explain step; weights are shares of the explanation unless
 *  the caller says otherwise (Monte Carlo weights are the share of runs a factor ranked first).
 *  `plain` words each factor in everyday language ("More troops helped Rome"). */
export function Reasons({ reasons, names, colors, top, weightTitle = SHARE_TITLE, weightNote = '', plain = false }: {
  reasons: Reason[]; names: [string, string]; colors: [string, string]; top?: number; weightTitle?: string; weightNote?: string; plain?: boolean;
}) {
  const [all, setAll] = useState(false);
  const shown = top && !all ? reasons.slice(0, top) : reasons;
  return (
    <>
      <ol className="rp-reasons">
        {shown.map((r, i) => (
          <li key={i}>
            <div className="rp-reason-head">
              <span className="rp-reason-rank">{i + 1}</span>
              {plain && PLAIN_FACTOR[r.factor]
                ? <><b title={`Factor: ${r.factor}`}>{PLAIN_FACTOR[r.factor]}</b><span className="small">helped <span style={{ color: colors[r.side] }}>{names[r.side]}</span></span></>
                : <><b>{r.factor}</b><span className="rp-muted small">favoured <span style={{ color: colors[r.side] }}>{names[r.side]}</span></span></>}
              <span className="rp-reason-w" title={weightTitle}>{Math.round(r.weight * 100)}%{weightNote && <span className="rp-muted small"> {weightNote}</span>}</span>
            </div>
            <div className="rp-reason-bar"><div style={{ width: `${Math.max(1, Math.round(r.weight * 100))}%`, background: colors[r.side] }} /></div>
            <div className={`small rp-reason-detail${plain ? ' rp-muted' : ''}`}>{r.detail}</div>
          </li>
        ))}
      </ol>
      {top != null && reasons.length > top && (
        <button className="rp-textbtn" onClick={() => setAll(!all)}>{all ? `Show the top ${top} only` : `Show all ${reasons.length} factors`}</button>
      )}
    </>
  );
}
