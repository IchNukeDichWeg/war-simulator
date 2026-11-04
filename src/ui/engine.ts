// UI-side client of the simulation worker (src/engine/worker.ts, contract in
// src/engine/protocol.ts). One worker for the live run, a second one for Monte
// Carlo so a batch never stalls the live view.
import type { EngineData, Frame, FromWorker, SimEvent, ToWorker } from '../engine/protocol';
import type { Scenario } from '../types/scenario';
import type { AppData } from './data';
import { fitBus, frameBus, resetBus } from './bus';
import { initialRun, setMc, setRun, store, toast } from './store';
import { engineAssetsReady } from './lazy';

export const REAL_TIME = 1 / 86400;

/** Chart history, mutated in place; `run.historyVersion` bumps when it changes. */
export const history = {
  day: [] as number[],
  personnel: [[], []] as [number[], number[]],
  casualties: [[], []] as [number[], number[]],
  supply: [[], []] as [number[], number[]],
  morale: [[], []] as [number[], number[]],
  territory: [[], []] as [number[], number[]],
};
export const eventLog: SimEvent[] = [];
const MAX_EVENTS = 5000;

function clearHistory() {
  history.day.length = 0;
  for (const k of ['personnel', 'casualties', 'supply', 'morale', 'territory'] as const) {
    history[k][0].length = 0; history[k][1].length = 0;
  }
  eventLog.length = 0;
}

function truncateHistory(beforeDay: number) {
  let n = history.day.length;
  while (n > 0 && history.day[n - 1] >= beforeDay) n--;
  history.day.length = n;
  for (const k of ['personnel', 'casualties', 'supply', 'morale', 'territory'] as const) {
    history[k][0].length = n; history[k][1].length = n;
  }
  let e = eventLog.length;
  while (e > 0 && eventLog[e - 1].day > beforeDay) e--;
  eventLog.length = e;
}

export function engineDataFrom(d: AppData | null): EngineData | string {
  if (!d) return 'Data not loaded yet.';
  const miss: string[] = [];
  if (d.snapshots.length === 0) miss.push('snapshots.json');
  if (!d.mechanics) miss.push('mechanics.json');
  if (!d.terrain) miss.push('terrain/grid.bin');
  if (d.fixtures) return 'Dev fixtures are synthetic placeholders and cannot be simulated.';
  if (miss.length) return `Engine cannot start: missing or empty ${miss.join(', ')}.`;
  return {
    snapshots: d.snapshots,
    doctrines: d.doctrines,
    mechanics: d.mechanics!,
    terrain: d.terrain!.slice(0),
    climate: d.climate ? d.climate.slice(0) : undefined,
    borders: d.borders,
  };
}

function spawn(onMsg: (m: FromWorker) => void, onFail: (msg: string) => void): Worker | null {
  try {
    const w = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<FromWorker>) => onMsg(e.data);
    w.onerror = (e) => { e.preventDefault(); onFail(e.message || 'Simulation worker failed to load (src/engine/worker.ts).'); };
    w.onmessageerror = () => onFail('Worker message could not be decoded.');
    return w;
  } catch (err) {
    onFail(`Could not create the simulation worker: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------- live run
let live: Worker | null = null;
/** The store data the live worker was initialised with. */
let liveData: AppData | null = null;
let liveReady = false;
let queue: ToWorker[] = [];
let lastFrameAt = 0;
let frameGapMs = 250;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let lastFlush = 0;
let pendingRun: Partial<typeof initialRun> = {};
/** Id of the latest start; frames and the end of an older run may still be in flight and are dropped. */
let runId = 0;

function post(msg: ToWorker) {
  if (live && liveReady) live.postMessage(msg);
  else queue.push(msg);
}

function flushRun() {
  flushTimer = undefined;
  lastFlush = performance.now();
  const s = store.get().run;
  setRun({ ...pendingRun, historyVersion: s.historyVersion + 1, eventsVersion: s.eventsVersion + 1 });
  pendingRun = {};
}
/** Forget a flush still waiting for the throttle: it holds the old run's day and maxDay. */
function dropPendingFlush() {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  pendingRun = {};
}
function scheduleFlush() {
  const since = performance.now() - lastFlush;
  if (since > 120) flushRun();
  else if (!flushTimer) flushTimer = setTimeout(flushRun, 120 - since);
}

function onFrame(f: Frame) {
  const now = performance.now();
  const gap = now - lastFrameAt;
  lastFrameAt = now;
  if (gap > 0 && gap < 2000) frameGapMs = frameGapMs * 0.7 + gap * 0.3;
  const lastDay = history.day.length ? history.day[history.day.length - 1] : -1;
  let replayed = false;
  if (f.day <= lastDay) { truncateHistory(f.day); replayed = true; }
  history.day.push(f.day);
  for (const s of [0, 1] as const) {
    const st = f.stats[s];
    history.personnel[s].push(st.personnel);
    history.casualties[s].push(st.casualties);
    history.supply[s].push(st.supply);
    history.morale[s].push(st.morale);
    history.territory[s].push(st.territory);
  }
  if (!replayed) {
    for (const e of f.events) eventLog.push(e);
    if (eventLog.length > MAX_EVENTS) eventLog.splice(0, eventLog.length - MAX_EVENTS);
  }
  const speed = store.get().run.speed;
  const interpMs = speed > 0 && !replayed && f.day === lastDay + 1 ? Math.min(1000, frameGapMs) : 0;
  frameBus.emit({ frame: f, interpMs });
  const maxDay = Math.max(store.get().run.maxDay, pendingRun.maxDay ?? 0, f.day);
  pendingRun = { ...pendingRun, day: f.day, date: f.date, stats: f.stats, maxDay };
  scheduleFlush();
}

function onLive(m: FromWorker) {
  if (m.type !== 'ready' && m.runId !== runId) return;
  switch (m.type) {
    case 'ready':
      liveReady = true;
      for (const q of queue) live!.postMessage(q);
      queue = [];
      break;
    case 'started':
      setRun({ status: 'running', theater: m.theater, sideNames: m.sideNames, warnings: m.warnings, result: null, maxDay: 0 });
      fitBus.emit(m.theater.bbox);
      break;
    case 'frame':
      onFrame(m.frame);
      break;
    case 'end':
      flushRun();
      setRun({ status: 'ended', result: m.result, speed: 0 });
      store.set({ rightTab: 'result' });
      break;
    case 'error':
      setRun({ status: 'error', engineError: m.message });
      toast('Engine error: ' + m.message);
      break;
    default:
      break;
  }
}

function failLive(msg: string) {
  setRun({ status: 'error', engineError: msg });
  live?.terminate();
  live = null;
  liveData = null;
  liveReady = false;
  queue = [];
}

function ensureLive(): boolean {
  const d = store.get().data;
  // merging Phase 3 eras or the engine assets makes a new data object: the worker needs it too,
  // else it skips the new snapshots as unknown
  if (live && d === liveData) return true;
  const data = engineDataFrom(d);
  if (typeof data === 'string') { setRun({ status: 'error', engineError: data }); return false; }
  if (!live) {
    live = spawn(onLive, failLive);
    if (!live) return false;
    liveReady = false;
    live.postMessage({ type: 'init', data } satisfies ToWorker);
  } else post({ type: 'init', data });   // the worker handles it before the start that follows
  liveData = d;
  return true;
}

export function scenarioProblems(s: Scenario): string[] {
  const p: string[] = [];
  const d = store.get().data;
  s.sides.forEach((side, i) => {
    if (side.members.length === 0) p.push(`${side.name || `Side ${i + 1}`} has no members.`);
    for (const m of side.members) if (d && !d.snapById.has(m)) p.push(`Unknown snapshot "${m}" on ${side.name}.`);
  });
  const [w, so, e, n] = s.theater.bbox;
  if (!(e > w && n > so)) p.push('Theater box is empty (east must exceed west, north must exceed south).');
  return p;
}

export function startRun(s: Scenario, speed = 1) {
  const probs = scenarioProblems(s);
  if (probs.length) { toast(probs[0]); return; }
  if (!engineAssetsReady('run', s, () => startRun(s, speed), () => store.get().run.status === 'starting', () => setRun({ status: 'idle' }))) { setRun({ status: 'starting' }); return; }
  clearHistory();
  dropPendingFlush();
  resetBus.emit();
  setRun({ ...initialRun, status: 'starting', speed, historyVersion: store.get().run.historyVersion + 1 });
  if (!ensureLive()) return;
  post({ type: 'start', scenario: s, runId: ++runId });
  post({ type: 'speed', daysPerSecond: speed });
  store.set({ rightTab: 'live' });
}

export function setSpeed(daysPerSecond: number) {
  setRun({ speed: daysPerSecond });
  if (live) post({ type: 'speed', daysPerSecond });
}

export function stepDays(days: number) {
  setRun({ speed: 0 });
  if (!live) return;
  post({ type: 'speed', daysPerSecond: 0 });
  post({ type: 'step', days });
}

export function seek(day: number) {
  if (!live) return;
  post({ type: 'seek', day: Math.max(0, Math.round(day)) });
}

export function stopRun() {
  runId++;
  live?.terminate();
  live = null;
  liveData = null;
  liveReady = false;
  queue = [];
  clearHistory();
  dropPendingFlush();
  resetBus.emit();
  setRun({ ...initialRun, historyVersion: store.get().run.historyVersion + 1 });
}

// ------------------------------------------------------------- monte carlo
let mcWorker: Worker | null = null;
/** The scenario object the current or last batch ran on; the view compares it by identity with
 *  the store's scenario (every edit makes a new object) to flag a stale result. */
export let mcScenario: Scenario | null = null;
/** performance.now() when the current batch started, for the progress ETA. */
export let mcStartedAt = 0;

export function runMonteCarlo(s: Scenario, runs: number) {
  const probs = scenarioProblems(s);
  if (probs.length) { toast(probs[0]); return; }
  if (!engineAssetsReady('mc', s, () => runMonteCarlo(s, runs), () => store.get().mc.status === 'running' && !mcWorker, () => setMc({ status: 'idle', total: 0 }))) { setMc({ status: 'running', done: 0, total: runs, result: null, error: null }); return; }
  const data = engineDataFrom(store.get().data);
  if (typeof data === 'string') { setMc({ status: 'error', error: data }); return; }
  mcWorker?.terminate();
  mcScenario = s;
  mcStartedAt = performance.now();
  setMc({ status: 'running', done: 0, total: runs, result: null, error: null });
  const fail = (msg: string) => { setMc({ status: 'error', error: msg }); mcWorker?.terminate(); mcWorker = null; };
  const w = spawn((m) => {
    if (m.type === 'ready') w?.postMessage({ type: 'montecarlo', scenario: s, runs } satisfies ToWorker);
    else if (m.type === 'mcProgress') setMc({ done: m.done, total: m.total });
    else if (m.type === 'mcResult') { setMc({ status: 'done', result: m.result, done: m.result.runs }); w?.terminate(); mcWorker = null; }
    else if (m.type === 'error') fail(m.message);
  }, fail);
  mcWorker = w;
  w?.postMessage({ type: 'init', data } satisfies ToWorker);
}

export function cancelMonteCarlo() {
  mcWorker?.terminate();
  mcWorker = null;
  setMc({ status: 'idle', done: 0, total: 0 });
}
