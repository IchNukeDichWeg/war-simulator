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
