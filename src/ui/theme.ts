// Current theme colours as JS values, for canvas charts (uPlot draws on a canvas, so CSS
// custom properties do not reach it). Reads the app's tokens from the body's computed style
// and re-reads them when the theme can have changed: an attribute or class change on <html>
// or <body> (a data-theme toggle) or a prefers-color-scheme change. Fallbacks are the dark
// palette the app shipped with, used when a token is not defined.
import { useSyncExternalStore } from 'react';

export interface ThemeTokens {
  fg: string;
  muted: string;
  line: string;
  bg: string;
  /** Panel background the run panel sits on. */
  panel: string;
}

const FALLBACK: ThemeTokens = { fg: '#e6edf3', muted: '#8b949e', line: '#30363d', bg: '#0d1117', panel: '#161b22' };

function read(): ThemeTokens {
  if (typeof document === 'undefined' || !document.body) return FALLBACK;
  const cs = getComputedStyle(document.body);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return { fg: v('--fg', FALLBACK.fg), muted: v('--muted', FALLBACK.muted), line: v('--line', FALLBACK.line), bg: v('--bg', FALLBACK.bg), panel: v('--bg2', v('--bg', FALLBACK.panel)) };
}

let current: ThemeTokens = FALLBACK;
let key = '';
const listeners = new Set<() => void>();
let teardown: (() => void) | null = null;

function refresh() {
  const t = read();
  const k = JSON.stringify(t);
  if (k === key) return;
  key = k; current = t;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!teardown && typeof window !== 'undefined') {
    refresh();
    const mo = new MutationObserver(() => refresh());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', refresh);
    teardown = () => { mo.disconnect(); mq?.removeEventListener?.('change', refresh); };
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && teardown) { teardown(); teardown = null; }
  };
}

export function useTheme(): ThemeTokens {
  return useSyncExternalStore(subscribe, () => current, () => FALLBACK);
}
