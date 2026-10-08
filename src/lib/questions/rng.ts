import { createHash } from "node:crypto";

/**
 * A small deterministic random generator. Every question is generated from a SEED, so the same
 * seed always produces the same question (testable, reproducible, and a generated question can be
 * re-created from its stored seed if it ever needs auditing).
 */
export class Rng {
  private state: number;

  constructor(seed: string | number) {
    const digest =
      typeof seed === "number" ? seed : createHash("sha256").update(seed).digest().readUInt32LE(0);
    this.state = digest >>> 0 || 0x9e3779b9;
  }

  /** Uniform in [0, 1) — mulberry32. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number {
    if (hi < lo) throw new RangeError(`Rng.int: empty range ${lo}..${hi}`);
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("Rng.pick: empty list");
    return items[Math.floor(this.next() * items.length)]!;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** `count` distinct picks. */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, count);
  }

  /** An n-digit whole number (no leading zero). */
  digits(n: number): number {
    if (n < 1 || n > 15) throw new RangeError("Rng.digits: 1..15");
    return this.int(n === 1 ? 0 : 10 ** (n - 1), 10 ** n - 1);
  }
}
