// Units as one MapLibre custom layer: WebGL2, instanced quads, ONE draw call
// for every formation and battle marker. Each instance draws two quads
// (body + heading arrow), selected in the vertex shader by gl_VertexID, so
// 6000 units = 6000 instances x 12 vertices in a single drawArraysInstanced.
// Symbol size follows personnel (log scale, relative to the frame).
// Mercator-only (the map is created with mercator projection).
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { U, UNIT_STRIDE, UnitStatus } from '../engine/protocol';
import { ARROW_INDEX, ATLAS_COLS, ROLES_PER_BAND, buildAtlas } from './atlas';
import { eraBand } from '../ui/roles';

/** Floats per GPU instance: prevX prevY x y | side icon strength heading | supply status kind phase | size 0 0 0 */
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

const VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_px;
uniform float u_t;
uniform float u_bearing;
layout(location=0) in vec4 a_pos;
layout(location=1) in vec4 a_a;
layout(location=2) in vec4 a_b;
layout(location=3) in vec4 a_c;
out vec2 v_local;
flat out vec4 v_a;
flat out vec4 v_b;
flat out float v_part;
flat out float v_size;
const vec2 C[6] = vec2[6](vec2(-1,-1), vec2(1,-1), vec2(1,1), vec2(-1,-1), vec2(1,1), vec2(-1,1));
void main() {
  int part = gl_VertexID / 6;
  vec2 c = C[gl_VertexID - part * 6];
  vec2 merc = mix(a_pos.xy, a_pos.zw, u_t);
  vec4 clip = u_matrix * vec4(merc, 0.0, 1.0);
  v_a = a_a; v_b = a_b; v_part = float(part); v_size = 0.0;
  vec2 off;
  if (a_b.z > 0.5) {
    if (part == 1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float r = 14.0 + 16.0 * clamp(a_b.w, 0.0, 1.0);
    v_size = r;
    off = c * r;
    v_local = off;
  } else if (part == 0) {
    off = c * vec2(16.0, 13.0);
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
  gl_Position = clip + vec4(off * u_px * 2.0 / u_viewport * clip.w, 0.0, 0.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform vec3 u_side[2];
uniform float u_time;
uniform float u_aa;
in vec2 v_local;
flat in vec4 v_a;
flat in vec4 v_b;
flat in float v_part;
flat in float v_size;
out vec4 o;
const float COLS = ${ATLAS_COLS.toFixed(1)};
const float RPB = ${ROLES_PER_BAND.toFixed(1)};
const float ARROW = ${ARROW_INDEX.toFixed(1)};
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
void main() {
  vec3 side = u_side[int(v_a.x + 0.5)];
  float phase = v_b.w;
  if (v_b.z > 0.5) {
    // battle marker: pulsing ring + core
    float d = length(v_local);
    float k = fract(u_time * 0.7 + phase * 3.1);
    float rr = v_size * (0.35 + 0.65 * k);
    float ring = (1.0 - smoothstep(1.2, 1.2 + u_aa * 2.0, abs(d - rr))) * (1.0 - k);
    float core = 1.0 - smoothstep(4.5, 4.5 + u_aa, d);
    vec3 col = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.9, 0.4), core);
    float a = max(ring * 0.9, core * 0.95);
    if (a < 0.01) discard;
    o = vec4(col * a, a);
    return;
  }
  float status = v_a.y < 0.0 ? 0.0 : v_b.y;
  float routing = status == 3.0 ? 1.0 : 0.0;
  float alphaMul = routing > 0.5 ? 0.55 + 0.35 * step(0.5, fract(u_time * 2.0 + phase)) : 1.0;
  if (v_part > 0.5) {
    vec2 uv = (v_local + 1.0) * 0.5;
    float m = atlasAt(ARROW, uv).a;
    if (m < 0.02) discard;
    vec3 col = mix(side, vec3(1.0), 0.55);
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
    acc = over(acc, fill, inside * 0.92);
    vec2 g;
    if (band > 1.5) g = (p - fc + vec2(15.0, 9.0)) / vec2(30.0, 18.0);
    else g = (p - fc + vec2(9.0)) / 18.0;
    if (g.x >= 0.0 && g.x <= 1.0 && g.y >= 0.0 && g.y <= 1.0) {
      float gm = atlasAt(v_a.y, g).a;
      acc = over(acc, vec3(0.04, 0.05, 0.07), gm * inside * 0.95);
    }
    if (routing > 0.5) {
      float hatch = step(0.5, fract((p.x + p.y) * 0.18));
      acc = over(acc, vec3(0.9, 0.1, 0.1), hatch * inside * 0.45);
    }
  }
  // border
  float bw = status == 5.0 ? 2.4 : 1.4;
  float border = 1.0 - smoothstep(bw * 0.5, bw * 0.5 + u_aa, abs(d));
  vec3 bcol = vec3(0.92);
  if (supply < 0.33) bcol = vec3(0.95, 0.25, 0.2);
  if (status == 4.0) bcol = vec3(0.75, 0.5, 1.0);
  if (status == 2.0) bcol = mix(vec3(1.0, 0.55, 0.0), vec3(1.0, 0.95, 0.5), 0.5 + 0.5 * sin(u_time * 8.0 + phase * 6.28));
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
    let logSum = 0, logN = 0;
    for (let i = 0; i < n; i++) {
      const o = i * UNIT_STRIDE;
      const p = units[o + U.personnel];
      if (units[o + U.status] === UnitStatus.Destroyed || !vis[i] || !(p > 0)) continue;
      logSum += Math.log2(p); logN++;
    }
    const logMean = logN ? logSum / logN : 0;
    const a = this.inst;
    let k = 0;
    let anim = battles.length > 0;
    for (let i = 0; i < n; i++) {
      const o = i * UNIT_STRIDE;
      const status = units[o + U.status];
      if (status === UnitStatus.Destroyed || !vis[i]) continue;
      const x = mercX(units[o + U.lon]);
      const y = mercY(units[o + U.lat]);
      const j = k * INST;
      let px = x, py = y;
      if (old) {
        const id = units[o + U.id];
        const pi = oldIdx.get(id);
        if (pi !== undefined) {
          const q = pi * INST;
          px = old[q] + (old[q + 2] - old[q]) * tPrev;
          py = old[q + 1] + (old[q + 3] - old[q + 1]) * tPrev;
        }
        newIdx.set(id, k);
      }
      a[j] = px; a[j + 1] = py; a[j + 2] = x; a[j + 3] = y;
      a[j + 4] = units[o + U.side];
      a[j + 5] = eraBand(units[o + U.techEra]) * ROLES_PER_BAND + Math.max(0, Math.min(ROLES_PER_BAND - 1, units[o + U.role] | 0));
      a[j + 6] = units[o + U.strength];
      const h = units[o + U.heading];
      a[j + 7] = Number.isFinite(h) && status !== UnitStatus.Idle && status !== UnitStatus.Garrison
        ? (HEADING_CONVENTION === 'math' ? h : Math.PI / 2 - h) : 999;
      a[j + 8] = units[o + U.supply];
      a[j + 9] = status;
      a[j + 10] = 0;
      a[j + 11] = ((units[o + U.id] * 0.6180339) % 1 + 1) % 1;
      const pers = units[o + U.personnel];
      a[j + 12] = pers > 0 ? Math.max(SIZE_MIN, Math.min(SIZE_MAX, 1 + SIZE_PER_DOUBLING * (Math.log2(pers) - logMean))) : 1;
      a[j + 13] = 0; a[j + 14] = 0; a[j + 15] = 0;
      if (status === UnitStatus.Engaged || status === UnitStatus.Routing) anim = true;
      k++;
    }
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

  clear() {
    this.count = 0;
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
    for (const u of ['u_matrix', 'u_viewport', 'u_px', 'u_t', 'u_bearing', 'u_atlas', 'u_side', 'u_time', 'u_aa']) this.loc[u] = gl.getUniformLocation(p, u);

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
    const px = scale * (g.drawingBufferWidth / this.map.getCanvas().clientWidth || 1);
    g.uniform1f(this.loc.u_px, px);
    g.uniform1f(this.loc.u_aa, 1 / Math.max(0.5, px));
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
    g.drawArraysInstanced(g.TRIANGLES, 0, 12, this.count);
    this.drawCalls = 1;
    g.bindVertexArray(null);
    if (t < 1) this.map.triggerRepaint();
    else if (this.animate && !this.pulseTimer) {
      this.pulseTimer = setTimeout(() => { this.pulseTimer = 0; this.map?.triggerRepaint(); }, PULSE_MS);
    }
  }

  /** Nearest visible unit to a screen point within maxPx, or -1. */
  pick(map: MlMap, x: number, y: number, maxPx = 16): number {
    const u = this.units;
    const n = Math.floor(u.length / UNIT_STRIDE);
    let best = -1, bd = maxPx * maxPx;
    const b = map.getBounds();
    for (let i = 0; i < n; i++) {
      if (!this.visible[i]) continue;
      const o = i * UNIT_STRIDE;
      const lon = u[o + U.lon], lat = u[o + U.lat];
      if (lat < b.getSouth() || lat > b.getNorth() || lon < b.getWest() || lon > b.getEast()) continue;
      const p = map.project([lon, lat]);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
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
