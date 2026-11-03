// Colour helpers for charts and side colours. Pure (no DOM), so they are unit-tested in
// tests/color.test.ts. Only #rgb, #rrggbb and rgb()/rgba() are parsed; anything else (named
// colours, oklch, ...) is passed through unchanged rather than guessed at.

export type RGB = [number, number, number];

export function parseColor(c: string | null | undefined): RGB | null {
  if (!c) return null;
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as RGB;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as RGB;
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (m) return [+m[1], +m[2], +m[3]].map((v) => Math.max(0, Math.min(255, Math.round(v)))) as RGB;
  return null;
}

export const toHex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function luminance([r, g, b]: RGB): number {
  const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG contrast ratio, 1 .. 21. */
export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The side colour, darkened or lightened just enough to reach `min` contrast against `bg`.
 * Side colours are user-picked and tuned for the dark theme; a pale yellow line on a light
 * panel disappears. 3:1 is the WCAG minimum for graphical objects. Returns the input unchanged
 * when it already passes or when either colour cannot be parsed.
 */
export function ensureContrast(color: string, bg: string | null | undefined, min = 3): string {
  const c = parseColor(color), b = parseColor(bg);
  if (!c || !b || contrast(c, b) >= min) return color;
  const target: RGB = luminance(b) > 0.4 ? [0, 0, 0] : [255, 255, 255];
  for (let t = 0.1; t <= 1.0001; t += 0.1) {
    const m = c.map((v, i) => v + (target[i] - v) * t) as RGB;
    if (contrast(m, b) >= min) return toHex(m);
  }
  return toHex(target);
}
