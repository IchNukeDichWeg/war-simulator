// Units as one MapLibre custom layer: WebGL2, instanced quads, ONE draw call
// for every formation and battle marker. Each instance draws two quads
// (body + heading arrow), selected in the vertex shader by gl_VertexID, so
// 6000 units = 6000 instances x 12 vertices in a single drawArraysInstanced.
// Symbol size follows personnel (log scale, relative to the frame).
// Mercator-only (the map is created with mercator projection).
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { U, UNIT_STRIDE, UnitStatus } from '../engine/protocol';
import { ARROW_INDEX, ATLAS_COLS, BATTLE_INDEX, DIGIT_INDEX, ROLES_PER_BAND, buildAtlas } from './atlas';
import { eraBand } from '../ui/roles';

/** Floats per GPU instance: prevX prevY x y | side icon strength heading | supply status kind phase | size count 0 0 */
const INST = 16;
/** Symbol scale per doubling of personnel over the frame's geometric mean, and its clamp.
 *  Log scale because formations span 1,000 to 100,000+ men; relative to the
 *  frame so a corps reads bigger than a brigade in any era without a table.
 *  The clamp keeps the smallest glyph legible and the largest off its neighbours. */
const SIZE_PER_DOUBLING = 0.15;
const SIZE_MIN = 0.8;
const SIZE_MAX = 1.3;
/** U.heading is read as a math angle in lon/lat space (0 = east, +pi/2 = north).
 *  If the engine uses compass bearings, flip this to 'compass'. */
const HEADING_CONVENTION: 'math' | 'compass' = 'math';
/** Display-only fog radius (km) around own formations. Not a model parameter:
 *  the engine applies its own scouting rules when the scenario's fog rule is on. */
export const FOG_RADIUS_KM = 120;
/** Repaint interval (ms) for purely decorative animation (battle pulse, engaged
 *  border) once movement interpolation has finished. MapLibre has no partial
 *  redraw, so every unit-layer repaint re-renders the whole map, terrain and
 *  rasters included. Requesting one per display frame made a paused run with
 *  any battle on screen render 215 times/s in an uncapped headless Chrome (M5
 *  Pro, 3280x2700 canvas; 684/s at 680x850), i.e. the display rate on a real
 *  screen. 20 Hz keeps the pulse smooth and measured 19 renders/s. */
const PULSE_MS = 50;
/** Level-of-detail switch. A screen cell is one full symbol's footprint (CSS px
 *  at zoom scale 1); a unit counts as overlapping when its cell is already taken.
 *  Compact discs from 25% overlapping (and at least 12 units), back to full
 *  symbols below 12% (or fewer than 6): a handful of stacked formations stays
 *  readable as symbols, a crowded theatre does not. */
const LOD_CELL_W = 30;
const LOD_CELL_H = 24;
const LOD_ENTER_SHARE = 0.25;
const LOD_ENTER_MIN = 12;
const LOD_LEAVE_SHARE = 0.12;
const LOD_LEAVE_MIN = 6;

const VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_px;
uniform float u_dpr;
uniform float u_lod;
uniform float u_t;
uniform float u_bearing;
uniform int u_hover;
uniform int u_sel;
layout(location=0) in vec4 a_pos;
layout(location=1) in vec4 a_a;
layout(location=2) in vec4 a_b;
layout(location=3) in vec4 a_c;
out vec2 v_local;
flat out vec4 v_a;
flat out vec4 v_b;
flat out float v_part;
flat out float v_size;
flat out float v_hl;
flat out float v_count;
const vec2 C[6] = vec2[6](vec2(-1,-1), vec2(1,-1), vec2(1,1), vec2(-1,-1), vec2(1,1), vec2(-1,1));
void main() {
  int part = gl_VertexID / 6;
  vec2 c = C[gl_VertexID - part * 6];
  vec2 merc = mix(a_pos.xy, a_pos.zw, u_t);
  vec4 clip = u_matrix * vec4(merc, 0.0, 1.0);
  v_a = a_a; v_b = a_b; v_part = float(part); v_size = 0.0;
  // 2 = selected, 1 = hovered: the quad grows to make room for the ring
  float hl = gl_InstanceID == u_sel ? 2.0 : gl_InstanceID == u_hover ? 1.0 : 0.0;
  v_hl = hl;
  v_count = a_c.y;
  float pad = hl > 0.5 ? 4.0 : 0.0;
  // stacks carry a count badge on the frame's top-right corner: grow the quad to hold it
  vec2 badgePad = a_c.y > 1.5 ? vec2(12.0, 5.0) : vec2(0.0);
  // compact markers are sized in CSS px (u_dpr), full symbols grow with zoom (u_px)
  float px = u_lod > 0.5 ? u_dpr : u_px;
  vec2 off;
  if (a_b.z > 0.5) {
    if (part == 1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float r = u_lod > 0.5 ? 10.0 + 10.0 * clamp(a_b.w, 0.0, 1.0) : 14.0 + 16.0 * clamp(a_b.w, 0.0, 1.0);
    v_size = r;
    off = c * r;
    v_local = off;
  } else if (u_lod > 0.5) {
    // compact: a disc of radius 4.5 CSS px x size, quad padded for the outline
    v_size = 4.5 * a_c.x;
    off = c * (v_size + (a_c.y > 1.5 ? 4.0 : 2.5) + pad);
    v_local = off;
  } else if (part == 0) {
    off = c * (vec2(16.0, 13.0) + max(vec2(pad), badgePad));
    v_local = off;
    off *= a_c.x;
  } else {
    float h = a_a.w;
    if (h > 100.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float ang = h + u_bearing;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 perp = vec2(-dir.y, dir.x);
    off = (dir * 23.0 + dir * c.x * 7.0 + perp * c.y * 7.0) * a_c.x;
    v_local = c;
  }
  gl_Position = clip + vec4(off * px * 2.0 / u_viewport * clip.w, 0.0, 0.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform vec3 u_side[2];
uniform float u_time;
uniform float u_aa;
uniform float u_lod;
in vec2 v_local;
flat in vec4 v_a;
flat in vec4 v_b;
flat in float v_part;
flat in float v_size;
flat in float v_hl;
flat in float v_count;
out vec4 o;
const float COLS = ${ATLAS_COLS.toFixed(1)};
const float RPB = ${ROLES_PER_BAND.toFixed(1)};
const float ARROW = ${ARROW_INDEX.toFixed(1)};
const float BATTLE = ${BATTLE_INDEX.toFixed(1)};
const float DIGITS = ${DIGIT_INDEX.toFixed(1)};
vec4 atlasAt(float idx, vec2 uv) {
  float col = mod(idx, COLS);
  float row = floor(idx / COLS);
  vec2 p = (vec2(col, row) + vec2(uv.x, 1.0 - uv.y)) / COLS;
  return texture(u_atlas, p);
}
float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
// premultiplied source-over: paint colour c with coverage a on top of dst
vec4 over(vec4 dst, vec3 c, float a) { return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a)); }
// stack count badge: dark pill with up to three digits centred on bc (999 caps it)
vec4 badge(vec4 acc, vec2 p, vec2 bc) {
  float cnt = min(v_count, 999.0);
  float nd = cnt >= 100.0 ? 3.0 : cnt >= 10.0 ? 2.0 : 1.0;
  float hw = nd * 3.3 + 2.2, hh = 5.6;
  float bd = sdBox(p - bc, vec2(hw, hh), hh);
  acc = over(acc, vec3(0.06, 0.07, 0.09), (1.0 - smoothstep(-u_aa * 0.5, u_aa * 0.5, bd)) * 0.95);
  acc = over(acc, vec3(0.92), 1.0 - smoothstep(0.5, 0.5 + u_aa, abs(bd)));
  float x0 = bc.x - nd * 3.3;
  float fx = (p.x - x0) / 6.6;
  float di = floor(fx);
  float fy = (p.y - bc.y) / 11.0 + 0.5;
  if (di >= 0.0 && di < nd && fy > 0.0 && fy < 1.0) {
    float dv = mod(floor(cnt / pow(10.0, nd - 1.0 - di) + 0.001), 10.0);
    // each digit cell is 32 px wide in a 64 px atlas cell; widen the sample a little so glyphs are not clipped
    float u = ((fx - di) - 0.5) * 1.15 + 0.5;
    if (u > 0.0 && u < 1.0) {
      float m = atlasAt(DIGITS + floor(dv / 2.0), vec2((mod(dv, 2.0) + u) * 0.5, fy)).a;
      acc = over(acc, vec3(1.0), m);
    }
  }
  return acc;
}
// hover / selection ring around a shape whose signed distance is d (dark-cased so it holds on any imagery)
vec4 ring(vec4 acc, float d) {
  if (v_hl < 0.5) return acc;
  vec3 c = v_hl > 1.5 ? vec3(0.95, 0.82, 0.42) : vec3(1.0);
  acc = over(acc, vec3(0.0), (1.0 - smoothstep(1.9, 1.9 + u_aa, abs(d - 3.0))) * 0.7);
  return over(acc, c, 1.0 - smoothstep(0.9, 0.9 + u_aa, abs(d - 3.0)));
}
void main() {
  vec3 side = u_side[int(v_a.x + 0.5)];
  float phase = v_b.w;
  if (v_b.z > 0.5) {
    // battle marker: dark disc with crossed swords, orange rim, and a ring
    // pulsing outward whose reach grows with the battle's intensity
    float d = length(v_local);
    float cr = u_lod > 0.5 ? 6.5 : 9.0;
    float k = fract(u_time * 0.7 + phase * 3.1);
    float rr = cr + (v_size - cr) * k;
    float ring = (1.0 - smoothstep(1.2, 1.2 + u_aa * 2.0, abs(d - rr))) * (1.0 - k);
    vec4 acc = over(vec4(0.0), vec3(1.0, 0.45, 0.1), ring * 0.9);
    float disc = 1.0 - smoothstep(cr - u_aa * 0.5, cr + u_aa * 0.5, d);
    acc = over(acc, vec3(0.08, 0.06, 0.05), disc * 0.92);
    vec2 g = v_local / (cr * 1.2) * 0.5 + 0.5;
    if (g.x > 0.0 && g.x < 1.0 && g.y > 0.0 && g.y < 1.0) acc = over(acc, vec3(1.0, 0.86, 0.55), atlasAt(BATTLE, g).a * disc);
    acc = over(acc, vec3(1.0, 0.5, 0.1), 1.0 - smoothstep(0.8, 0.8 + u_aa, abs(d - cr)));
    if (acc.a < 0.01) discard;
    o = acc;
    return;
  }
  float status = v_a.y < 0.0 ? 0.0 : v_b.y;
  float routing = status == 3.0 ? 1.0 : 0.0;
  // Status is carried by shape and pattern, not by red or blinking: side colours
  // are user-picked and often red themselves, and a blinking unit drew the eye
  // away from the battles. Routing = greyed fill + dark hatch (compact: hollow
  // ring), low supply = dashed border, engaged = orange border.
  float alphaMul = routing > 0.5 ? 0.85 : 1.0;
  vec3 grey = vec3(0.55, 0.56, 0.58);
  if (u_lod > 0.5) {
    // compact marker: side-coloured disc, dark outline for contrast on any imagery
    float d = length(v_local) - v_size;
    float supplyC = clamp(v_b.x, 0.0, 1.0);
    vec3 fill = mix(side, vec3(0.42, 0.36, 0.30), (1.0 - supplyC) * 0.6);
    float bw = 1.2;
    vec3 bcol = vec3(0.05, 0.06, 0.08);
    if (status == 2.0) { bcol = vec3(1.0, 0.6, 0.1); bw = 1.8; }
    vec4 acc = vec4(0.0);
    if (routing > 0.5) {
      // hollow ring in the side colour
      acc = over(acc, mix(side, grey, 0.35), 1.0 - smoothstep(1.1, 1.1 + u_aa, abs(d + 1.6)));
    } else {
      acc = over(acc, fill, 1.0 - smoothstep(-u_aa * 0.5, u_aa * 0.5, d));
    }
    acc = over(acc, bcol, 1.0 - smoothstep(bw * 0.5, bw * 0.5 + u_aa, abs(d)));
    // a stack of formations gets a second, light outline
    if (v_count > 1.5) acc = over(acc, vec3(0.92), 1.0 - smoothstep(0.55, 0.55 + u_aa, abs(d - 2.3)));
    acc *= alphaMul;
    acc = ring(acc, d + (v_count > 1.5 ? 1.5 : 0.0));
    if (acc.a < 0.01) discard;
    o = acc;
    return;
  }
  if (v_part > 0.5) {
    vec2 uv = (v_local + 1.0) * 0.5;
    float m = atlasAt(ARROW, uv).a;
    if (m < 0.02) discard;
    vec3 col = mix(routing > 0.5 ? grey : side, vec3(1.0), 0.55);
    float a = m * 0.95 * alphaMul;
    o = vec4(col * a, a);
    return;
  }
  vec2 p = v_local;
  float band = floor(v_a.y / RPB);
  float supply = clamp(v_b.x, 0.0, 1.0);
  vec4 acc = vec4(0.0);
  // frame: x [-15,15], y [-6,12]
  vec2 fc = vec2(0.0, 3.0);
  float r = band > 1.5 ? 1.5 : 5.0;
  float d = sdBox(p - fc, vec2(15.0, 9.0), r);
  float inside = 1.0 - smoothstep(-u_aa * 0.5, u_aa * 0.5, d);
  if (inside > 0.0) {
    vec3 starved = vec3(0.42, 0.36, 0.30);
    vec3 fill = mix(side, starved, (1.0 - supply) * 0.75);
    if (status == 6.0) fill = mix(fill, vec3(0.6, 0.8, 1.0), 0.35);
    if (routing > 0.5) fill = mix(fill, grey, 0.6);
    acc = over(acc, fill, inside * 0.92);
    vec2 g;
    if (band > 1.5) g = (p - fc + vec2(15.0, 9.0)) / vec2(30.0, 18.0);
    else g = (p - fc + vec2(9.0)) / 18.0;
    if (g.x >= 0.0 && g.x <= 1.0 && g.y >= 0.0 && g.y <= 1.0) {
      float gm = atlasAt(v_a.y, g).a;
      acc = over(acc, vec3(0.04, 0.05, 0.07), gm * inside * 0.95);
    }
    if (routing > 0.5) {
      float hatch = step(0.6, fract((p.x - p.y) * 0.16));
      acc = over(acc, vec3(0.05, 0.05, 0.07), hatch * inside * 0.55);
    }
  }
  // border: garrison thick, low supply dashed, besieging violet, engaged orange
  float bw = status == 5.0 ? 2.4 : status == 2.0 ? 2.0 : 1.4;
  float border = 1.0 - smoothstep(bw * 0.5, bw * 0.5 + u_aa, abs(d));
  if (supply < 0.33) border *= step(0.45, fract((p.x + p.y) * 0.14));
  vec3 bcol = vec3(0.92);
  if (status == 4.0) bcol = vec3(0.75, 0.5, 1.0);
  if (status == 2.0) bcol = mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 0.8, 0.35), 0.5 + 0.5 * sin(u_time * 4.0 + phase * 6.28));
  acc = over(acc, vec3(0.05, 0.06, 0.08), (1.0 - smoothstep(bw * 0.5 + 1.0, bw * 0.5 + 1.0 + u_aa, abs(d))) * 0.6);
  acc = over(acc, bcol, border);
  // strength bar: y [-12,-8]
  if (p.y > -12.5 && p.y < -7.5 && abs(p.x) < 15.5) {
    float s = clamp(v_a.z, 0.0, 1.0);
    vec3 bar = s > 0.5 ? mix(vec3(0.95, 0.8, 0.2), vec3(0.3, 0.85, 0.35), (s - 0.5) * 2.0) : mix(vec3(0.9, 0.2, 0.15), vec3(0.95, 0.8, 0.2), s * 2.0);
    float inBar = step(-12.0, p.y) * step(p.y, -8.0) * step(abs(p.x), 15.0);
    float filled = step((p.x + 15.0) / 30.0, s);
    acc = over(acc, vec3(0.0), inBar * 0.75);
    acc = over(acc, bar, inBar * filled);
  }
  acc *= alphaMul;
  acc = ring(acc, sdBox(p, vec2(15.5, 12.0), r)); // around frame and strength bar
  if (v_count > 1.5) acc = badge(acc, p, vec2(14.0, 12.0));
  if (acc.a < 0.01) discard;
  o = acc;
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('unit shader: ' + gl.getShaderInfoLog(s));
  return s;
}

export function mercX(lon: number) { return (lon + 180) / 360; }
export function mercY(lat: number) {
  const l = Math.max(-85.05, Math.min(85.05, lat));
  return (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360))) / 360;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  if (!Number.isFinite(n)) return [0.8, 0.8, 0.8];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export interface FogOptions { enabled: boolean; side: 0 | 1; radiusKm: number }
export interface Battle { lat: number; lon: number; intensity: number }

export class UnitLayer implements CustomLayerInterface {
  id = 'units';
  type = 'custom' as const;
  renderingMode = '2d' as const;

  private map: MlMap | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buf: WebGLBuffer | null = null;
  private tex: WebGLTexture | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};

  private inst = new Float32Array(INST * 1024);
  private count = 0;
  private dirty = false;
  private t0 = 0;
  private interpMs = 0;
  private animate = false;
  private pulseTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private sideRgb = new Float32Array([0.85, 0.3, 0.3, 0.3, 0.55, 0.9]);
  private lastIdx = new Map<number, number>();
  /** Raw units of the last update, for hover picking. */
  units: Float32Array = new Float32Array(0);
  visible: Uint8Array = new Uint8Array(0);
  /** CPU ms spent in the last setUnits (fog + packing), for the perf overlay. */
  lastCpuMs = 0;
  drawCalls = 0;
  /** Level of detail: 0 = full symbols, 1 = compact discs. Chosen per frame from
   *  how many on-screen symbols would overlap (see updateLod). */
  lod: 0 | 1 = 0;
  /** Forces a level of detail (debug and measurement); null = automatic. */
  lodOverride: 0 | 1 | null = null;
  /** CPU ms of the last overlap estimate, for the perf overlay. */
  lodCpuMs = 0;
  private unitInstances = 0;
  /** Instance -> index into `units` of the stack's representative, for picking. */
  private instUnit = new Int32Array(1024);
  /** Unit -> instance (-1 = not drawn), and the next member of its stack (-1 = last). */
  private unitInst = new Int32Array(1024);
  private nextInStack = new Int32Array(1024);
  private hashKeys = new Int32Array(0);
  private hashVal = new Int32Array(0);
  private hashGen = new Uint32Array(0);
  private hashStamp = 0;
  private stackPers = new Float64Array(1024);
  private selUnit = -1;
  /** Hovered / selected formation ids (NaN = none) and their instance indices this frame (-1 = not drawn). */
  private hoverId = NaN;
  private selId = NaN;
  private hoverK = -1;
  private selK = -1;
  private lastScale = 1;
  private cssW = 0;
  private cssH = 0;
  private hasMatrix = false;
  private pickMatrix = new Float64Array(16);
  private lodDirty = true;
  private lastMatrix = new Float64Array(16);
  private lodGrid = new Uint8Array(0);

  setSideColors(a: string, b: string) {
    this.sideRgb.set([...hexToRgb(a), ...hexToRgb(b)]);
    this.map?.triggerRepaint();
  }

  /** Replace the unit set. interpMs > 0 animates from the previous positions (matched by id). */
  setUnits(units: Float32Array, battles: Battle[], fog: FogOptions, interpMs = 0) {
    const t = performance.now();
    const n = Math.floor(units.length / UNIT_STRIDE);
    const vis = this.visible.length >= n ? this.visible : new Uint8Array(Math.max(n, 1024));
    computeVisibility(units, n, fog, vis);
    const need = (n + battles.length) * INST;
    if (this.inst.length < need) {
      const next = new Float32Array(Math.max(need, this.inst.length * 2));
      next.set(this.inst.subarray(0, this.count * INST));
      this.inst = next;
    }
    const old = interpMs > 0 ? this.inst.slice(0, this.count * INST) : null;
    const oldIdx = this.lastIdx;
    const tPrev = this.currentT();
    const newIdx = interpMs > 0 ? new Map<number, number>() : oldIdx;
    if (interpMs <= 0) newIdx.clear();
    const a = this.inst;
    if (this.instUnit.length < n) {
      const len = Math.max(n, this.instUnit.length * 2);
      this.instUnit = new Int32Array(len); this.unitInst = new Int32Array(len); this.nextInStack = new Int32Array(len);
    }
    const iu = this.instUnit, ui = this.unitInst, nx = this.nextInStack;
    this.hoverK = -1; this.selK = -1; this.selUnit = -1;
    // Pass 1: formations of one side on the same spot (the engine puts them on
    // cell centres, so the match is exact) become one stack and one instance.
    // In a real run 94 formations sat on 6 positions; drawn one by one, 59 of
    // them were a single symbol with nothing to say so.
    // Open-addressing table keyed on (lon, lat) to 0.001 deg and side; a JS Map
    // with float keys made setUnits 0.77 ms for 6000 units, this keeps it near 0.3.
    let cap = this.hashKeys.length;
    if (cap < n * 2) {
      cap = 1024;
      while (cap < n * 2) cap <<= 1;
      this.hashKeys = new Int32Array(cap * 3); this.hashVal = new Int32Array(cap); this.hashGen = new Uint32Array(cap);
    }
    cap = this.hashVal.length;
    const mask = cap - 1, hk = this.hashKeys, hv = this.hashVal, hg = this.hashGen;
    const gen = ++this.hashStamp;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const o = i * UNIT_STRIDE;
      ui[i] = -1;
      if (units[o + U.status] === UnitStatus.Destroyed || !vis[i]) continue;
      const qx = Math.round(units[o + U.lon] * 1000), qy = Math.round(units[o + U.lat] * 1000), sd = units[o + U.side] | 0;
      let h = (Math.imul(qx, 73856093) ^ Math.imul(qy, 19349663) ^ Math.imul(sd + 1, 83492791)) & mask;
      let g = -1;
      while (hg[h] === gen) {
        if (hk[h * 3] === qx && hk[h * 3 + 1] === qy && hk[h * 3 + 2] === sd) { g = hv[h]; break; }
        h = (h + 1) & mask;
      }
      if (g < 0) {
        hg[h] = gen; hk[h * 3] = qx; hk[h * 3 + 1] = qy; hk[h * 3 + 2] = sd; hv[h] = k;
        iu[k] = i; nx[i] = -1; ui[i] = k; k++;
        continue;
      }
      // representative = biggest formation (its icon and heading stand for the stack)
      const head = iu[g];
      nx[i] = head; ui[i] = g;
      if (units[o + U.personnel] > units[head * UNIT_STRIDE + U.personnel]) iu[g] = i;
      else { nx[i] = nx[head]; nx[head] = i; }
    }
    const nStacks = k;
    // Pass 2: aggregate each stack and pack its instance
    let logSum = 0, logN = 0;
    const persOf = this.stackPers.length >= nStacks ? this.stackPers : (this.stackPers = new Float64Array(Math.max(nStacks, 1024)));
    for (let s = 0; s < nStacks; s++) {
      let p = 0;
      for (let i = iu[s]; i >= 0; i = nx[i]) p += Math.max(0, units[i * UNIT_STRIDE + U.personnel]);
      persOf[s] = p;
      if (p > 0) { logSum += Math.log2(p); logN++; }
    }
    const logMean = logN ? logSum / logN : 0;
    let anim = battles.length > 0;
    for (k = 0; k < nStacks; k++) {
      const rep = iu[k];
      const o = rep * UNIT_STRIDE;
      let cnt = 0, pers = 0, strW = 0, sup = 0, routing = 0, engaged = false;
      for (let i = rep; i >= 0; i = nx[i]) {
        const q = i * UNIT_STRIDE;
        const p = Math.max(0, units[q + U.personnel]);
        cnt++; pers += p; strW += units[q + U.strength] * (p || 1); sup += units[q + U.supply];
        const st = units[q + U.status];
        if (st === UnitStatus.Engaged) engaged = true;
        if (st === UnitStatus.Routing) routing++;
        const uid = units[q + U.id];
        if (uid === this.hoverId) this.hoverK = k;
        if (uid === this.selId) { this.selK = k; this.selUnit = i; }
        if (old) newIdx.set(uid, k);
      }
      // a stack is engaged if any member is, routing only if most members are
      const status = engaged ? UnitStatus.Engaged : routing * 2 > cnt ? UnitStatus.Routing : cnt > 1 && units[o + U.status] === UnitStatus.Routing ? UnitStatus.Moving : units[o + U.status];
      const x = mercX(units[o + U.lon]);
      const y = mercY(units[o + U.lat]);
      const j = k * INST;
      let px = x, py = y;
      if (old) {
        // previous position: the representative's, else any member's
        let pi = oldIdx.get(units[o + U.id]);
        for (let i = rep; pi === undefined && i >= 0; i = nx[i]) pi = oldIdx.get(units[i * UNIT_STRIDE + U.id]);
        if (pi !== undefined) {
          const q = pi * INST;
          px = old[q] + (old[q + 2] - old[q]) * tPrev;
          py = old[q + 1] + (old[q + 3] - old[q + 1]) * tPrev;
        }
      }
      a[j] = px; a[j + 1] = py; a[j + 2] = x; a[j + 3] = y;
      a[j + 4] = units[o + U.side];
      a[j + 5] = eraBand(units[o + U.techEra]) * ROLES_PER_BAND + Math.max(0, Math.min(ROLES_PER_BAND - 1, units[o + U.role] | 0));
      a[j + 6] = pers > 0 ? strW / pers : units[o + U.strength];
      const h = units[o + U.heading];
      a[j + 7] = Number.isFinite(h) && status !== UnitStatus.Idle && status !== UnitStatus.Garrison
        ? (HEADING_CONVENTION === 'math' ? h : Math.PI / 2 - h) : 999;
      a[j + 8] = sup / cnt;
      a[j + 9] = status;
      a[j + 10] = 0;
      a[j + 11] = ((units[o + U.id] * 0.6180339) % 1 + 1) % 1;
      a[j + 12] = persOf[k] > 0 ? Math.max(SIZE_MIN, Math.min(SIZE_MAX, 1 + SIZE_PER_DOUBLING * (Math.log2(persOf[k]) - logMean))) : 1;
      a[j + 13] = cnt; a[j + 14] = 0; a[j + 15] = 0;
      if (status === UnitStatus.Engaged) anim = true;
    }
    this.unitInstances = k;
    this.lodDirty = true;
    for (const b of battles) {
      const j = k * INST;
      const x = mercX(b.lon), y = mercY(b.lat);
      a[j] = x; a[j + 1] = y; a[j + 2] = x; a[j + 3] = y;
      a[j + 4] = 0; a[j + 5] = -1; a[j + 6] = 1; a[j + 7] = 999;
      a[j + 8] = 1; a[j + 9] = 0; a[j + 10] = 1; a[j + 11] = Math.max(0, Math.min(1, b.intensity));
      a[j + 12] = 1; a[j + 13] = 0; a[j + 14] = 0; a[j + 15] = 0;
      k++;
    }
    this.count = k;
    this.lastIdx = newIdx;
    this.units = units;
    this.visible = vis;
    this.interpMs = interpMs;
    this.t0 = performance.now();
    this.animate = anim;
    this.dirty = true;
    this.lastCpuMs = performance.now() - t;
    this.map?.triggerRepaint();
  }

  /** Highlights a formation by id (null = none). Survives new frames. */
  setHover(id: number | null) { this.hoverId = id ?? NaN; this.hoverK = this.instOf(this.findUnit(this.hoverId)); this.map?.triggerRepaint(); }
  setSelected(id: number | null) {
    this.selId = id ?? NaN;
    this.selUnit = this.findUnit(this.selId);
    this.selK = this.instOf(this.selUnit);
    this.map?.triggerRepaint();
  }
  get selectedId(): number | null { return Number.isNaN(this.selId) ? null : this.selId; }
  /** Index into `units` of the selected formation if it is drawn this frame, else -1. */
  get selectedUnit(): number { return this.selK >= 0 ? this.selUnit : -1; }

  /** Indices into `units` of every formation drawn in the same stack as unit i
   *  (representative first), or [] if i is not drawn. */
  stackMembers(i: number): number[] {
    const k = this.instOf(i);
    if (k < 0) return [];
    const out: number[] = [];
    for (let j = this.instUnit[k]; j >= 0; j = this.nextInStack[j]) out.push(j);
    return out;
  }

  private instOf(i: number): number { return i >= 0 && i < this.units.length / UNIT_STRIDE ? this.unitInst[i] : -1; }

  private findUnit(id: number): number {
    if (Number.isNaN(id)) return -1;
    const u = this.units, n = u.length / UNIT_STRIDE;
    for (let i = 0; i < n; i++) if (u[i * UNIT_STRIDE + U.id] === id) return i;
    return -1;
  }

  clear() {
    this.count = 0;
    this.unitInstances = 0;
    this.hoverK = -1; this.selK = -1; this.selUnit = -1;
    this.lodDirty = true;
    this.units = new Float32Array(0);
    this.lastIdx.clear();
    this.dirty = true;
    this.map?.triggerRepaint();
  }

  get instanceCount() { return this.count; }

  private currentT() {
    if (this.interpMs <= 0) return 1;
    return Math.min(1, (performance.now() - this.t0) / this.interpMs);
  }

  onAdd(map: MlMap, gl: WebGL2RenderingContext) {
    this.map = map;
    this.gl = gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('unit program: ' + gl.getProgramInfoLog(p));
    this.prog = p;
    for (const u of ['u_matrix', 'u_viewport', 'u_px', 'u_dpr', 'u_lod', 'u_t', 'u_bearing', 'u_atlas', 'u_side', 'u_time', 'u_aa', 'u_hover', 'u_sel']) this.loc[u] = gl.getUniformLocation(p, u);

    this.vao = gl.createVertexArray();
    this.buf = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    for (let l = 0; l < 4; l++) {
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, 4, gl.FLOAT, false, INST * 4, l * 16);
      gl.vertexAttribDivisor(l, 1);
    }
    gl.bindVertexArray(null);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, buildAtlas());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.dirty = true;
  }

  onRemove(_map: MlMap, gl: WebGL2RenderingContext) {
    if (this.prog) gl.deleteProgram(this.prog);
    if (this.buf) gl.deleteBuffer(this.buf);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.tex) gl.deleteTexture(this.tex);
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    this.pulseTimer = 0;
    this.map = null;
  }

  render(gl: WebGL2RenderingContext | WebGLRenderingContext, args: CustomRenderMethodInput) {
    const g = gl as WebGL2RenderingContext;
    if (!this.prog || !this.map) return;
    this.drawCalls = 0;
    if (this.count === 0) return;
    g.useProgram(this.prog);
    g.bindVertexArray(this.vao);
    g.bindBuffer(g.ARRAY_BUFFER, this.buf);
    if (this.dirty) {
      const bytes = this.count * INST * 4;
      const size = g.getBufferParameter(g.ARRAY_BUFFER, g.BUFFER_SIZE) as number;
      if (size < bytes) g.bufferData(g.ARRAY_BUFFER, this.inst.byteLength, g.DYNAMIC_DRAW);
      g.bufferSubData(g.ARRAY_BUFFER, 0, this.inst, 0, this.count * INST);
      this.dirty = false;
    }
    const m = args.defaultProjectionData.mainMatrix as unknown as ArrayLike<number>;
    g.uniformMatrix4fv(this.loc.u_matrix, false, m instanceof Float32Array ? m : Float32Array.from(m));
    g.uniform2f(this.loc.u_viewport, g.drawingBufferWidth, g.drawingBufferHeight);
    const zoom = this.map.getZoom();
    const scale = Math.max(0.62, Math.min(1.25, 0.62 + (zoom - 2.5) * 0.14));
    const canvas = this.map.getCanvas();
    const dpr = g.drawingBufferWidth / canvas.clientWidth || 1;
    const px = scale * dpr;
    this.updateLod(m, canvas.clientWidth, canvas.clientHeight, scale);
    this.lastScale = scale; this.cssW = canvas.clientWidth; this.cssH = canvas.clientHeight; this.hasMatrix = true;
    for (let i = 0; i < 16; i++) this.pickMatrix[i] = m[i];
    const compact = this.lod === 1;
    g.uniform1i(this.loc.u_hover, this.hoverK);
    g.uniform1i(this.loc.u_sel, this.selK);
    g.uniform1f(this.loc.u_px, px);
    g.uniform1f(this.loc.u_dpr, dpr);
    g.uniform1f(this.loc.u_lod, this.lod);
    g.uniform1f(this.loc.u_aa, 1 / Math.max(0.5, compact ? dpr : px));
    const t = this.currentT();
    g.uniform1f(this.loc.u_t, t);
    g.uniform1f(this.loc.u_bearing, (this.map.getBearing() * Math.PI) / 180);
    g.uniform1f(this.loc.u_time, (performance.now() / 1000) % 1000);
    g.uniform3fv(this.loc.u_side, this.sideRgb);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, this.tex);
    g.uniform1i(this.loc.u_atlas, 0);
    g.disable(g.DEPTH_TEST);
    g.disable(g.STENCIL_TEST);
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    // compact markers have no heading arrow: 6 vertices per instance instead of 12
    g.drawArraysInstanced(g.TRIANGLES, 0, compact ? 6 : 12, this.count);
    this.drawCalls = 1;
    g.bindVertexArray(null);
    if (t < 1) this.map.triggerRepaint();
    else if (this.animate && !this.pulseTimer) {
      this.pulseTimer = setTimeout(() => { this.pulseTimer = 0; this.map?.triggerRepaint(); }, PULSE_MS);
    }
  }

  /** Picks the level of detail from the share of on-screen full symbols that
   *  would land in an already occupied symbol-sized screen cell. Recomputed only
   *  when the camera or the units changed. Full symbols that pile on each other
   *  are unreadable (a 6000-unit theatre at zoom 3 was a solid block of frames)
   *  and the overdraw is the unit layer's main GPU cost; discs keep the shape of
   *  each side's mass and the fronts. Hysteresis stops flicker at the boundary. */
  private updateLod(m: ArrayLike<number>, w: number, h: number, scale: number) {
    if (this.lodOverride !== null) { this.lod = this.lodOverride; return; }
    let same = !this.lodDirty;
    for (let i = 0; i < 16 && same; i++) if (this.lastMatrix[i] !== m[i]) same = false;
    if (same) return;
    const t0 = performance.now();
    for (let i = 0; i < 16; i++) this.lastMatrix[i] = m[i];
    this.lodDirty = false;
    const cw = LOD_CELL_W * scale, ch = LOD_CELL_H * scale;
    const cols = Math.max(1, Math.ceil(w / cw)), rows = Math.max(1, Math.ceil(h / ch));
    if (this.lodGrid.length < cols * rows) this.lodGrid = new Uint8Array(cols * rows * 2);
    const grid = this.lodGrid;
    grid.fill(0, 0, cols * rows);
    const a = this.inst;
    let seen = 0, dup = 0;
    for (let k = 0; k < this.unitInstances; k++) {
      const j = k * INST;
      const x = a[j + 2], y = a[j + 3];
      const cw4 = m[3] * x + m[7] * y + m[15];
      if (cw4 <= 0) continue;
      const sx = ((m[0] * x + m[4] * y + m[12]) / cw4 * 0.5 + 0.5) * w;
      const sy = (0.5 - (m[1] * x + m[5] * y + m[13]) / cw4 * 0.5) * h;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const c = ((sy / ch) | 0) * cols + ((sx / cw) | 0);
      seen++;
      if (grid[c]) dup++; else grid[c] = 1;
    }
    const share = seen ? dup / seen : 0;
    if (this.lod === 0 && dup >= LOD_ENTER_MIN && share > LOD_ENTER_SHARE) this.lod = 1;
    else if (this.lod === 1 && (dup < LOD_LEAVE_MIN || share < LOD_LEAVE_SHARE)) this.lod = 0;
    this.lodCpuMs = performance.now() - t0;
  }

  /** Index into `units` of the drawn formation nearest a screen point (CSS px),
   *  or -1. Works on the instance buffer with the last frame's matrix, so it
   *  hits where the symbol is drawn mid-interpolation and skips destroyed and
   *  fogged units. maxPx defaults to the symbol's own half-size. */
  pick(_map: MlMap | null, x: number, y: number, maxPx?: number): number {
    if (!this.hasMatrix) return -1;
    const m = this.pickMatrix, a = this.inst, w = this.cssW, h = this.cssH;
    const r = maxPx ?? (this.lod === 1 ? 8 : 18 * this.lastScale);
    const t = this.currentT();
    let best = -1, bd = r * r;
    for (let k = 0; k < this.unitInstances; k++) {
      const j = k * INST;
      const mx = a[j] + (a[j + 2] - a[j]) * t, my = a[j + 1] + (a[j + 3] - a[j + 1]) * t;
      const cw = m[3] * mx + m[7] * my + m[15];
      if (cw <= 0) continue;
      const sx = ((m[0] * mx + m[4] * my + m[12]) / cw * 0.5 + 0.5) * w;
      const sy = (0.5 - (m[1] * mx + m[5] * my + m[13]) / cw * 0.5) * h;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d <= bd) { bd = d; best = k; } // <= : later instances draw on top, so prefer them
    }
    return best < 0 ? -1 : this.instUnit[best];
  }
}

/** Fog of war for display: enemy formations are visible only within radiusKm of
 *  an own formation. Spatial hash on an equirectangular km grid, O(n). */
function computeVisibility(units: Float32Array, n: number, fog: FogOptions, out: Uint8Array) {
  if (!fog.enabled) { out.fill(1, 0, n); return; }
  const R = fog.radiusKm;
  const own = new Map<number, number[]>();
  const key = (gx: number, gy: number) => gx * 100003 + gy;
  const KM = 111.32;
  for (let i = 0; i < n; i++) {
    const o = i * UNIT_STRIDE;
    if (units[o + U.side] !== fog.side || units[o + U.status] === UnitStatus.Destroyed) continue;
    const lat = units[o + U.lat];
    const x = units[o + U.lon] * KM * Math.cos((lat * Math.PI) / 180);
    const y = lat * KM;
    const k = key(Math.floor(x / R), Math.floor(y / R));
    let arr = own.get(k);
    if (!arr) own.set(k, (arr = []));
    arr.push(x, y);
  }
  const R2 = R * R;
  for (let i = 0; i < n; i++) {
    const o = i * UNIT_STRIDE;
    if (units[o + U.side] === fog.side) { out[i] = 1; continue; }
    const lat = units[o + U.lat];
    const x = units[o + U.lon] * KM * Math.cos((lat * Math.PI) / 180);
    const y = lat * KM;
    const gx = Math.floor(x / R), gy = Math.floor(y / R);
    let seen = 0;
    for (let dx = -1; dx <= 1 && !seen; dx++) {
      for (let dy = -1; dy <= 1 && !seen; dy++) {
        const arr = own.get(key(gx + dx, gy + dy));
        if (!arr) continue;
        for (let q = 0; q < arr.length; q += 2) {
          if ((arr[q] - x) ** 2 + (arr[q + 1] - y) ** 2 <= R2) { seen = 1; break; }
        }
      }
    }
    out[i] = seen;
  }
}
