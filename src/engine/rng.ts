// Seeded RNG for the simulation: sfc32 (Chris Doty-Humphrey's Small Fast
// Counting generator), seeded through splitmix32. The whole generator state is
// four uint32 words in a Uint32Array, so it is cloned and restored exactly with
// the rest of the sim state (replay, keyframes). No Math.random anywhere.

export class Rng {
  /** Generator state; the sim points this at SimState.rng so clone/restore covers it. */
  s: Uint32Array;

  constructor(seed: number) {
    this.s = new Uint32Array(4);
    this.reseed(seed);
  }

  reseed(seed: number): void {
    let x = seed >>> 0;
    for (let i = 0; i < 4; i++) {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      z ^= z >>> 16;
      this.s[i] = z >>> 0;
    }
    for (let i = 0; i < 12; i++) this.u32();
  }

  /** Uniform uint32. */
  u32(): number {
    const s = this.s;
    let a = s[0], b = s[1], c = s[2], d = s[3];
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    s[0] = a; s[1] = b; s[2] = c; s[3] = d;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Standard normal (Box-Muller, no cached second value so state stays 4 words). */
  normal(): number {
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Lognormal with mean 1 and log-sd sigma. */
  lognormal(sigma: number): number {
    return Math.exp(sigma * this.normal() - (sigma * sigma) / 2);
  }

  getState(): Uint32Array {
    return this.s.slice();
  }

  setState(st: ArrayLike<number>): void {
    for (let i = 0; i < 4; i++) this.s[i] = st[i] >>> 0;
  }
}
