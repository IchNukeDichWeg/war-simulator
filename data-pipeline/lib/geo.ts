// Geometry helpers for the pipeline: simplification, spherical area, point in polygon.

export type Ring = number[][];        // [[lon, lat], ...]
export type Polygon = Ring[];         // outer ring + holes
export type MultiPolygon = Polygon[];

/** Douglas-Peucker on one ring, tolerance in degrees. Keeps rings closed and >= 4 points. */
export function simplifyRing(ring: Ring, tol: number): Ring {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0, idx = -1;
    const [ax, ay] = ring[a], [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = ring.filter((_, i) => keep[i]).map(([x, y]) => [round(x), round(y)]);
  return out.length >= 4 ? out : ring.map(([x, y]) => [round(x), round(y)]);
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function toMulti(geom: { type: string; coordinates: unknown }): MultiPolygon {
  if (geom.type === 'Polygon') return [geom.coordinates as Polygon];
  if (geom.type === 'MultiPolygon') return geom.coordinates as MultiPolygon;
  return [];
}

export function simplifyMulti(mp: MultiPolygon, tol: number, minAreaKm2 = 50): MultiPolygon {
  return mp
    .filter((p) => ringAreaKm2(p[0]) >= minAreaKm2)
    .map((p) => p.map((r) => simplifyRing(r, tol)).filter((r) => r.length >= 4));
}

const R = 6371.0088;
/** Spherical excess area of a ring in km2 (absolute value). */
export function ringAreaKm2(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    s += ((x2 - x1) * Math.PI) / 180 * (2 + Math.sin((y1 * Math.PI) / 180) + Math.sin((y2 * Math.PI) / 180));
  }
  return Math.abs((s * R * R) / 2);
}

export function multiAreaKm2(mp: MultiPolygon): number {
  let a = 0;
  for (const p of mp) { a += ringAreaKm2(p[0]); for (let h = 1; h < p.length; h++) a -= ringAreaKm2(p[h]); }
  return a;
}

export function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInMulti(x: number, y: number, mp: MultiPolygon): boolean {
  for (const p of mp) {
    if (!pointInRing(x, y, p[0])) continue;
    let hole = false;
    for (let h = 1; h < p.length; h++) if (pointInRing(x, y, p[h])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

export function bboxOf(mp: MultiPolygon): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of mp) for (const [x, y] of p[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}
