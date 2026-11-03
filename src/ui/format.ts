export function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || !Number.isFinite(n)) return '-';
  const a = Math.abs(n);
  const p = (v: number) => String(Number(v.toPrecision(Math.max(digits, Math.ceil(Math.log10(Math.abs(v) + 1))))));
  if (a >= 1e12) return p(n / 1e12) + 'T';
  if (a >= 1e9) return p(n / 1e9) + 'B';
  if (a >= 1e6) return p(n / 1e6) + 'M';
  if (a >= 1e4) return p(n / 1e3) + 'k';
  if (a >= 100) return Math.round(n).toLocaleString('en-US');
  if (a === 0) return '0';
  if (a < 0.01) return n.toExponential(1);
  return n.toFixed(a < 1 ? 2 : 1);
}
export const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '-' : `${Math.round(v * 100)}%`);
export const isUrl = (s: string) => /^https?:\/\//.test(s);

/** "1 day", "34 days", "120 days (about 4 months)", "800 days (about 2.2 years)". */
export function fmtDays(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  const d = Math.round(n);
  const base = `${d.toLocaleString('en-US')} ${d === 1 ? 'day' : 'days'}`;
  if (d >= 730) return `${base} (about ${(d / 365.25).toFixed(1)} years)`;
  if (d >= 60) return `${base} (about ${Math.round(d / 30.44)} months)`;
  return base;
}

/** Signed value with an explicit + for gains: "+1.2k", "-340", "0". */
export function signed(n: number | null | undefined, f: (v: number) => string = fmt): string {
  if (n == null || !Number.isFinite(n)) return '-';
  if (n === 0) return f(0);
  return n > 0 ? `+${f(n)}` : `-${f(-n)}`;
}

/** Signed change of a 0..1 fraction in percentage points: "+3 pts", "-12 pts", "0 pts". */
export function signedPts(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-';
  const p = Math.round(n * 100);
  return `${p > 0 ? '+' : p < 0 ? '-' : ''}${Math.abs(p)} pts`;
}

/** Playback speed label; 1/86400 days per second is real time. */
export function fmtSpeed(daysPerSecond: number): string {
  if (!(daysPerSecond > 0)) return 'paused';
  if (Math.abs(daysPerSecond - 1 / 86400) < 1e-9) return 'real time';
  const n = Number.isInteger(daysPerSecond) ? daysPerSecond.toLocaleString('en-US') : fmt(daysPerSecond);
  return `${n} ${daysPerSecond === 1 ? 'day' : 'days'}/s`;
}

/** First letter upper-cased, for engine strings like "time limit" used as a headline. */
export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
