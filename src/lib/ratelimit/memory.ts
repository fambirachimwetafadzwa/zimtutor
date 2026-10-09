import type { Counted, RateLimitPort } from "./limiter";
import type { Bucket, Limit } from "./policy";

/**
 * Counters in memory, with the same arithmetic as the database functions (fixed windows aligned to
 * the clock). For tests, and for anything that wants the behaviour without a database.
 */
export class MemoryRateLimitPort implements RateLimitPort {
  private readonly counts = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  private windowOf(limit: Limit): { key: string; endsInSeconds: number } {
    const seconds = this.now() / 1000;
    const start = Math.floor(seconds / limit.seconds) * limit.seconds;
    return {
      key: String(start),
      endsInSeconds: Math.max(1, Math.ceil(start + limit.seconds - seconds)),
    };
  }

  private id(bucket: Bucket, subjectHash: string, window: string): string {
    return `${bucket}|${subjectHash}|${window}`;
  }

  async hit(bucket: Bucket, subjectHash: string, limit: Limit): Promise<Counted> {
    const window = this.windowOf(limit);
    const id = this.id(bucket, subjectHash, window.key);
    const hits = (this.counts.get(id) ?? 0) + 1;
    this.counts.set(id, hits);
    return { allowed: hits <= limit.max, hits, retryAfterSeconds: window.endsInSeconds };
  }

  async peek(bucket: Bucket, subjectHash: string, limit: Limit): Promise<Counted> {
    const window = this.windowOf(limit);
    const hits = this.counts.get(this.id(bucket, subjectHash, window.key)) ?? 0;
    return { allowed: hits < limit.max, hits, retryAfterSeconds: window.endsInSeconds };
  }

  async clear(bucket: Bucket, subjectHash: string): Promise<void> {
    for (const id of [...this.counts.keys()])
      if (id.startsWith(`${bucket}|${subjectHash}|`)) this.counts.delete(id);
  }

  /** How many counters are held (tests look at what is, and is not, kept). */
  get size(): number {
    return this.counts.size;
  }
}
