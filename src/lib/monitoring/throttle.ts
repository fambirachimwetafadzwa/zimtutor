/**
 * A cap on how many reports one server sends: no more than `perKey` of the same kind in a window, and
 * `total` of any kind. A fault that happens a thousand times a minute is told once or twice, not a
 * thousand times, and a monitoring service can never be the thing that slows the application down.
 */
export class Throttle {
  private readonly seen = new Map<string, number[]>();
  private all: number[] = [];

  constructor(
    private readonly options: { perKey: number; total: number; windowMs: number; maxKeys?: number },
    private readonly now: () => number = Date.now,
  ) {}

  /** True if a report of this kind may be sent now (and counts it). */
  allow(key: string): boolean {
    const t = this.now();
    const cutoff = t - this.options.windowMs;
    this.all = this.all.filter((at) => at > cutoff);
    if (this.all.length >= this.options.total) return false;

    const times = (this.seen.get(key) ?? []).filter((at) => at > cutoff);
    if (times.length >= this.options.perKey) {
      this.seen.set(key, times);
      return false;
    }
    times.push(t);
    this.seen.set(key, times);
    this.all.push(t);

    // never grow without bound: drop the kinds not seen lately
    const maxKeys = this.options.maxKeys ?? 200;
    if (this.seen.size > maxKeys) {
      for (const [k, v] of this.seen) if (v.every((at) => at <= cutoff)) this.seen.delete(k);
      if (this.seen.size > maxKeys) this.seen.clear();
    }
    return true;
  }
}
