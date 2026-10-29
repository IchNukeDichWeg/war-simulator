// Generated icon atlas for the unit layer. White glyphs on transparent, drawn
// once with Canvas 2D at startup (no image assets, no licensing questions).
// Layout: 8 x 8 cells of CELL px. Icon index = band * 19 + roleIndex; the
// heading arrow lives in the last cell.
import { ROLE_ORDER } from '../ui/roles';
import type { UnitRole } from '../types/schema';

export const CELL = 64;
export const ATLAS_COLS = 8;
export const ATLAS_SIZE = CELL * ATLAS_COLS;
export const ARROW_INDEX = ATLAS_COLS * ATLAS_COLS - 1;
export const ROLES_PER_BAND = ROLE_ORDER.length;

type Ctx = CanvasRenderingContext2D;

function line(c: Ctx, pts: number[]) {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.stroke();
}
function poly(c: Ctx, pts: number[]) {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fill();
}
function circle(c: Ctx, x: number, y: number, r: number, fill = true) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  if (fill) c.fill(); else c.stroke();
}

// ---- shared silhouettes -------------------------------------------------
function horseHead(c: Ctx, s = 1, ox = 0, oy = 0) {
  poly(c, [22, 50, 24, 30, 30, 18, 38, 12, 46, 16, 50, 24, 46, 26, 40, 22, 36, 28, 36, 50].map((v, i) => (i % 2 ? v * s + oy : v * s + ox)));
}
function shipHull(c: Ctx) {
  poly(c, [6, 40, 58, 40, 50, 50, 14, 50]);
}
function plane(c: Ctx) {
  poly(c, [32, 6, 36, 22, 58, 32, 58, 36, 36, 32, 35, 48, 42, 54, 42, 57, 32, 54, 22, 57, 22, 54, 29, 48, 28, 32, 6, 36, 6, 32, 28, 22]);
}

// ---- band 0: ancient / medieval ------------------------------------------
function ancient(c: Ctx, role: UnitRole) {
  switch (role) {
    case 'infantry_line': // spear behind a round shield
      line(c, [12, 56, 52, 8]);
      poly(c, [48, 6, 56, 4, 54, 12]);
      circle(c, 30, 36, 15);
      c.globalCompositeOperation = 'destination-out';
      circle(c, 30, 36, 5);
      c.globalCompositeOperation = 'source-over';
      break;
    case 'infantry_light': // two crossed javelins + small shield
      line(c, [10, 54, 50, 10]); line(c, [54, 54, 14, 10]);
      poly(c, [46, 8, 54, 6, 52, 14]); poly(c, [18, 8, 10, 6, 12, 14]);
      circle(c, 32, 40, 9);
      break;
    case 'missile_infantry': // bow and arrow
      c.beginPath(); c.arc(22, 32, 24, -1.1, 1.1); c.stroke();
      line(c, [32, 10, 32, 54]);
      line(c, [14, 32, 56, 32]);
      poly(c, [58, 32, 50, 27, 50, 37]);
      break;
    case 'cavalry_heavy': // horse head + couched lance
      horseHead(c);
      line(c, [4, 44, 60, 10]);
      break;
    case 'cavalry_light': // horse head + small bow
      horseHead(c);
      c.beginPath(); c.arc(14, 30, 10, -1.3, 1.3); c.stroke();
      break;
    case 'chariots': // spoked wheel + draught pole
      circle(c, 26, 38, 15, false);
      for (let a = 0; a < 6; a++) line(c, [26, 38, 26 + 15 * Math.cos(a * 1.047), 38 + 15 * Math.sin(a * 1.047)]);
      line(c, [40, 34, 60, 22]);
      poly(c, [10, 18, 36, 18, 34, 26, 12, 26]);
      break;
    case 'elephants': // elephant silhouette
      poly(c, [10, 22, 14, 14, 30, 12, 46, 14, 50, 22, 54, 30, 56, 42, 52, 42, 50, 32, 48, 32, 48, 52, 42, 52, 42, 40, 22, 40, 22, 52, 16, 52, 16, 40, 10, 36]);
      break;
    case 'artillery': // torsion engine / trebuchet
      poly(c, [8, 48, 56, 48, 56, 54, 8, 54]);
      line(c, [18, 48, 30, 24, 42, 48]);
      line(c, [12, 30, 54, 14]);
      circle(c, 54, 14, 5);
      break;
    case 'ships_major': case 'ships_minor': // galley with oars
      shipHull(c);
      for (let x = 14; x <= 50; x += 9) line(c, [x, 50, x - 5, 58]);
      line(c, [32, 40, 32, 12]);
      poly(c, [32, 14, 48, 22, 32, 30]);
      break;
    default:
      genericGlyph(c, role);
  }
}

// ---- band 1: gunpowder / Napoleonic ----------------------------------------
function musket(c: Ctx, x0: number, y0: number, x1: number, y1: number) {
  c.save();
  c.lineWidth = 5;
  line(c, [x0, y0, x1, y1]);
  c.lineWidth = 2;
  const dx = x1 - x0, dy = y1 - y0;
  line(c, [x1, y1, x1 + dx * 0.15, y1 + dy * 0.15]); // bayonet
  c.restore();
}
function gunpowder(c: Ctx, role: UnitRole) {
  switch (role) {
    case 'infantry_line': // crossed muskets with bayonets
      musket(c, 12, 54, 46, 14); musket(c, 52, 54, 18, 14);
      break;
    case 'infantry_light': // single musket + horn
      musket(c, 12, 54, 48, 12);
      circle(c, 22, 22, 7, false);
      break;
    case 'missile_infantry':
      musket(c, 10, 50, 50, 14);
      line(c, [14, 26, 34, 40]);
      break;
    case 'cavalry_heavy': // horse head + sabre
      horseHead(c);
      c.beginPath(); c.moveTo(6, 56); c.quadraticCurveTo(20, 20, 58, 6); c.stroke();
      break;
    case 'cavalry_light':
      horseHead(c);
      musket(c, 6, 40, 22, 14);
      break;
    case 'artillery': // cannon on a wheel
      c.save(); c.lineWidth = 9; line(c, [10, 40, 54, 22]); c.restore();
      circle(c, 28, 44, 11, false);
      circle(c, 28, 44, 3);
      break;
    case 'ships_major': case 'ships_minor': // ship of the line
      shipHull(c);
      line(c, [22, 40, 22, 8]); line(c, [42, 40, 42, 12]);
      poly(c, [12, 12, 32, 12, 30, 34, 14, 34]);
      poly(c, [34, 16, 52, 16, 50, 36, 36, 36]);
      break;
    default:
      genericGlyph(c, role);
  }
}

// ---- band 2: NATO APP-6 style (frame drawn by the shader) ------------------
function nato(c: Ctx, role: UnitRole) {
  c.lineWidth = 3.5;
  switch (role) {
    case 'infantry_line': case 'infantry_light': case 'missile_infantry':
      line(c, [4, 4, 60, 60]); line(c, [60, 4, 4, 60]);
      if (role === 'infantry_light') { line(c, [26, 10, 38, 10]); }
      if (role === 'missile_infantry') { circle(c, 32, 32, 6); }
      break;
    case 'cavalry_heavy': case 'cavalry_light':
      line(c, [4, 60, 60, 4]);
      if (role === 'cavalry_heavy') { c.beginPath(); c.ellipse(32, 32, 18, 9, 0, 0, Math.PI * 2); c.stroke(); }
      break;
    case 'chariots': case 'elephants':
      line(c, [4, 60, 60, 4]);
      break;
    case 'armor':
      c.beginPath(); c.ellipse(32, 32, 22, 12, 0, 0, Math.PI * 2); c.stroke();
      break;
    case 'ifv_apc':
      line(c, [4, 4, 60, 60]); line(c, [60, 4, 4, 60]);
      c.beginPath(); c.ellipse(32, 32, 20, 10, 0, 0, Math.PI * 2); c.stroke();
      break;
    case 'artillery':
      circle(c, 32, 32, 8);
      break;
    case 'aircraft_fighter':
      plane(c);
      break;
    case 'aircraft_strike':
      plane(c);
      c.globalCompositeOperation = 'destination-out'; circle(c, 32, 30, 5); c.globalCompositeOperation = 'source-over';
      break;
    case 'helicopters': // bow-tie rotor
      poly(c, [10, 18, 32, 32, 10, 46]); poly(c, [54, 18, 32, 32, 54, 46]);
      break;
    case 'drones':
      poly(c, [4, 30, 32, 22, 60, 30, 32, 40]);
      line(c, [32, 40, 32, 54]);
      break;
    case 'ships_major':
      shipHull(c); line(c, [32, 40, 32, 16]); poly(c, [22, 26, 42, 26, 40, 40, 24, 40]);
      break;
    case 'ships_minor':
      poly(c, [14, 36, 50, 36, 44, 46, 20, 46]); line(c, [32, 36, 32, 22]);
      break;
    case 'submarines':
      c.beginPath(); c.ellipse(32, 38, 24, 7, 0, 0, Math.PI * 2); c.fill();
      poly(c, [28, 32, 38, 32, 36, 22, 30, 22]);
      break;
    case 'missiles':
      poly(c, [32, 4, 38, 16, 38, 50, 44, 58, 20, 58, 26, 50, 26, 16]);
      break;
    case 'air_defense':
      c.beginPath(); c.arc(32, 52, 26, Math.PI, 0); c.stroke();
      circle(c, 32, 40, 6);
      break;
    default:
      genericGlyph(c, role);
  }
}

/** Fallback for roles that do not exist in an era (e.g. armor at tech 3). */
function genericGlyph(c: Ctx, role: UnitRole) {
  if (role === 'armor' || role === 'ifv_apc') { c.beginPath(); c.ellipse(32, 32, 22, 12, 0, 0, Math.PI * 2); c.stroke(); return; }
  if (role.startsWith('aircraft') || role === 'drones') { plane(c); return; }
  if (role === 'helicopters') { poly(c, [10, 18, 32, 32, 10, 46]); poly(c, [54, 18, 32, 32, 54, 46]); return; }
  if (role === 'submarines') { c.beginPath(); c.ellipse(32, 38, 24, 7, 0, 0, Math.PI * 2); c.fill(); return; }
  if (role === 'missiles') { poly(c, [32, 4, 38, 16, 38, 50, 26, 50, 26, 16]); return; }
  if (role === 'air_defense') { c.beginPath(); c.arc(32, 52, 26, Math.PI, 0); c.stroke(); return; }
  if (role === 'ships_major' || role === 'ships_minor') { shipHull(c); return; }
  circle(c, 32, 32, 10);
}

function arrow(c: Ctx) {
  // points to +x (east); the shader rotates it by heading
  poly(c, [60, 32, 30, 10, 30, 24, 4, 24, 4, 40, 30, 40, 30, 54]);
}

export function buildAtlas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = ATLAS_SIZE;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#fff';
  c.strokeStyle = '#fff';
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const draw = (idx: number, f: (c: Ctx) => void) => {
    c.save();
    c.translate((idx % ATLAS_COLS) * CELL, Math.floor(idx / ATLAS_COLS) * CELL);
    c.beginPath(); c.rect(0, 0, CELL, CELL); c.clip();
    c.lineWidth = 4;
    f(c);
    c.restore();
  };
  ROLE_ORDER.forEach((role, r) => {
    draw(r, (cx) => ancient(cx, role));
    draw(ROLES_PER_BAND + r, (cx) => gunpowder(cx, role));
    draw(2 * ROLES_PER_BAND + r, (cx) => nato(cx, role));
  });
  draw(ARROW_INDEX, arrow);
  return cv;
}
