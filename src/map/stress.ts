// Dev stress test: N synthetic formations moving every animation frame, so the
// full CPU path (fog, packing, buffer upload) and the single instanced draw run
// at display rate. Synthetic, never shown as data.
import { U, UNIT_STRIDE, UnitStatus } from '../engine/protocol';
import type { Battle } from './unitLayer';

export class StressSim {
  units: Float32Array;
  battles: Battle[] = [];
  private vel: Float32Array;
  constructor(public n: number, private bbox: [number, number, number, number]) {
    this.units = new Float32Array(n * UNIT_STRIDE);
    this.vel = new Float32Array(n * 2);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const [w, s, e, nn] = bbox;
    for (let i = 0; i < n; i++) {
      const o = i * UNIT_STRIDE;
      const side = i % 2;
      const u = this.units;
      // two loose fronts so fog and engagements are meaningful
      u[o + U.lon] = w + (e - w) * (side ? 0.5 + rnd() * 0.5 : rnd() * 0.5);
      u[o + U.lat] = s + (nn - s) * rnd();
      u[o + U.side] = side;
      u[o + U.role] = Math.floor(rnd() * 19);
      u[o + U.strength] = 0.15 + rnd() * 0.85;
      u[o + U.supply] = rnd();
      u[o + U.morale] = rnd();
      const r = rnd();
      u[o + U.status] = r < 0.55 ? UnitStatus.Moving : r < 0.75 ? UnitStatus.Engaged : r < 0.82 ? UnitStatus.Routing : r < 0.9 ? UnitStatus.Garrison : UnitStatus.Idle;
      u[o + U.id] = i;
      u[o + U.personnel] = Math.round(2000 + rnd() * 20000);
      u[o + U.techEra] = rnd() * 10;
      const ang = rnd() * Math.PI * 2;
      const sp = 0.002 + rnd() * 0.01;
      this.vel[i * 2] = Math.cos(ang) * sp;
      this.vel[i * 2 + 1] = Math.sin(ang) * sp;
      u[o + U.heading] = ang;
    }
    for (let b = 0; b < 40; b++) this.battles.push({ lon: w + (e - w) * (0.45 + rnd() * 0.1), lat: s + (nn - s) * rnd(), intensity: rnd() });
  }
  step() {
    const [w, s, e, n] = this.bbox;
    const u = this.units;
    for (let i = 0; i < this.n; i++) {
      const o = i * UNIT_STRIDE;
      const st = u[o + U.status];
      if (st !== UnitStatus.Moving && st !== UnitStatus.Routing) continue;
      let lon = u[o + U.lon] + this.vel[i * 2];
      let lat = u[o + U.lat] + this.vel[i * 2 + 1];
      if (lon < w || lon > e) { this.vel[i * 2] *= -1; lon = Math.max(w, Math.min(e, lon)); }
      if (lat < s || lat > n) { this.vel[i * 2 + 1] *= -1; lat = Math.max(s, Math.min(n, lat)); }
      u[o + U.lon] = lon; u[o + U.lat] = lat;
      u[o + U.heading] = Math.atan2(this.vel[i * 2 + 1], this.vel[i * 2]);
    }
  }
}
