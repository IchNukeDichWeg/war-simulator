// Generates docs/banner.svg, the README banner: a control-cell map with a front line, units,
// capitals and an era timeline. Seeded, so a rerun gives the same file.
// Usage: node scripts/make-banner.mjs docs/banner.svg
import { writeFileSync } from 'node:fs';

const W = 1280, H = 440;
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const BLUE = '#4f8df7', RED = '#ef5a4f', SEA = '#0d2038';
const CELL = 15, GAP = 2;
const X0 = 520, Y0 = 0, Y1 = 330;

// the front: a wandering line with a blue salient pushing east in the middle
const front = (y) => 880 + 45 * Math.sin(y / 46) + 70 * Math.exp(-((y - 170) ** 2) / 2600) - 20 * Math.cos(y / 19);
// a sea in the top right and a bay in the bottom right; cells there are water
const isSea = (x, y) => (x - 1270) ** 2 / 190 ** 2 + (y + 10) ** 2 / 95 ** 2 < 1 || (x - 1180) ** 2 / 70 ** 2 + (y - 345) ** 2 / 55 ** 2 < 1;

const cells = [];
for (let x = X0; x < W; x += CELL + GAP) {
  for (let y = Y0; y < Y1; y += CELL + GAP) {
    const cx = x + CELL / 2, cy = y + CELL / 2;
    if (isSea(cx, cy)) continue;
    const d = cx - front(cy);
    let fill, op;
    if (Math.abs(d) < 14 && rnd() < 0.55) { fill = rnd() < 0.5 ? BLUE : RED; op = 0.32; }
    else { fill = d < 0 ? BLUE : RED; op = 0.16 + 0.22 * Math.exp(-Math.abs(d) / 90) + 0.05 * rnd(); }
    cells.push(`<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${fill}" fill-opacity="${op.toFixed(2)}"/>`);
  }
}

// front line path
const fpts = [];
for (let y = -5; y <= Y1 + 5; y += 6) fpts.push(`${front(y).toFixed(1)},${y}`);
const frontPath = `M${fpts.join(' L')}`;

// a river crossing the front
const river = 'M560,250 C640,232 700,262 780,240 S900,205 960,222 S1060,268 1130,250';

// unit markers (NATO-style frames): infantry = X, armour = oval
const unit = (x, y, col, kind) => {
  const sym = kind === 'inf'
    ? `<path d="M${x - 12},${y - 7} L${x + 12},${y + 7} M${x - 12},${y + 7} L${x + 12},${y - 7}" stroke="${col}" stroke-width="1.6"/>`
    : `<rect x="${x - 8}" y="${y - 4}" width="16" height="8" rx="4" fill="none" stroke="${col}" stroke-width="1.6"/>`;
  return `<g><rect x="${x - 14}" y="${y - 9}" width="28" height="18" rx="2" fill="#0b1424" stroke="${col}" stroke-width="1.8"/>${sym}</g>`;
};
const units = [
  [836, 64, BLUE, 'inf'], [858, 150, BLUE, 'arm'], [884, 206, BLUE, 'inf'], [820, 292, BLUE, 'arm'],
  [948, 92, RED, 'arm'], [994, 170, RED, 'inf'], [1010, 262, RED, 'inf'], [1040, 300, RED, 'arm'],
].map(([x, y, c, k]) => unit(x, y, c, k)).join('');

// advance arrows
const arrows = [
  ['M770,186 C840,182 900,140 978,124', BLUE],
  ['M1075,262 C1010,276 920,262 862,236', RED],
].map(([d, c]) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" marker-end="url(#head-${c === BLUE ? 'b' : 'r'})" opacity="0.95"/>`).join('');

// capitals
const star = (cx, cy, r, col) => {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    p.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${p.join(' ')}" fill="${col}" stroke="#0b1424" stroke-width="1.5"/>`;
};
const capitals = star(770, 100, 10, '#dce8ff') + star(1150, 160, 10, '#ffe1dc');

// era timeline
const eras = [[-2250, 'Bronze'], [-480, 'Iron'], [117, 'Rome'], [1241, 'Medieval'], [1805, 'Napoleonic'], [1914, 'World wars'], [1989, 'Cold war'], [2026, 'Today']];
const TX0 = 64, TX1 = 1216, TY = 392;
const tx = (i) => TX0 + (i * (TX1 - TX0)) / (eras.length - 1);
const fmt = (y) => (y < 0 ? `${-y} BC` : `${y}`);
const timeline = [
  `<line x1="${TX0}" y1="${TY}" x2="${TX1}" y2="${TY}" stroke="url(#tl)" stroke-width="2"/>`,
  ...eras.map(([y, name], i) => {
    const x = tx(i);
    return `<circle cx="${x}" cy="${TY}" r="4.5" fill="#0b1220" stroke="#8fa3c4" stroke-width="2"/>`
      + `<text x="${x}" y="${TY - 14}" text-anchor="middle" class="yr">${fmt(y)}</text>`
      + `<text x="${x}" y="${TY + 24}" text-anchor="middle" class="era">${name}</text>`;
  }),
].join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="War Simulator: states from any era fight on a real-world map">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a1020"/><stop offset="1" stop-color="#121c33"/></linearGradient>
  <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.2" stop-color="#fff" stop-opacity="0.35"/><stop offset="0.42" stop-color="#fff" stop-opacity="1"/></linearGradient>
  <mask id="m"><rect x="${X0}" y="0" width="${W - X0}" height="${Y1}" fill="url(#fade)"/></mask>
  <linearGradient id="vfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.75" stop-color="#0a1020" stop-opacity="0"/><stop offset="1" stop-color="#0d1629" stop-opacity="1"/></linearGradient>
  <linearGradient id="tl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8fa3c4" stop-opacity="0.15"/><stop offset="0.5" stop-color="#8fa3c4" stop-opacity="0.7"/><stop offset="1" stop-color="#8fa3c4" stop-opacity="0.15"/></linearGradient>
  <marker id="head-b" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${BLUE}"/></marker>
  <marker id="head-r" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${RED}"/></marker>
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .title { font-size: 64px; font-weight: 800; fill: #f2f5fb; letter-spacing: -1.5px; }
    .sub { font-size: 22px; fill: #b7c3d9; }
    .tag { font-size: 14px; fill: #8fa3c4; letter-spacing: 1.6px; font-weight: 600; }
    .yr { font-size: 13px; fill: #c9d4e8; font-weight: 600; }
    .era { font-size: 12px; fill: #7d8fae; letter-spacing: 0.6px; }
  </style>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<g mask="url(#m)">
  <rect x="${X0}" y="0" width="${W - X0}" height="${Y1}" fill="${SEA}" opacity="0.5"/>
  ${cells.join('')}
  <path d="${river}" fill="none" stroke="#5aa7d6" stroke-width="2.2" opacity="0.55"/>
  <path d="${frontPath}" fill="none" stroke="#f2f5fb" stroke-width="2" stroke-dasharray="7 5" opacity="0.7"/>
  ${arrows}
  ${units}
  ${capitals}
</g>
<rect x="0" y="0" width="${W}" height="${Y1 + 10}" fill="url(#vfade)"/>
<text x="64" y="104" class="tag">MULTI-ERA WAR SIMULATOR</text>
<text x="62" y="172" class="title">War Simulator</text>
<text x="64" y="214" class="sub">Pit states from any era against each other</text>
<text x="64" y="244" class="sub">on a real-world map, day by day.</text>
${timeline}
</svg>
`;
writeFileSync(process.argv[2], svg);
console.log(`wrote ${process.argv[2]}: ${cells.length} cells, ${svg.length} bytes`);
