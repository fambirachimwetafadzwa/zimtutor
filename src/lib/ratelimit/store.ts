import type { SupabaseClient } from "@supabase/supabase-js";
import type { Counted, RateLimitPort } from "./limiter";
import type { Bucket, Limit } from "./policy";

interface CountedRow {
  allowed: boolean;
  hits: number;
  retry_after_seconds: number;
}

/** The counters in the database (the rate_limit_* functions; callable only with the service role). */
export class SupabaseRateLimitPort implements RateLimitPort {
  constructor(private readonly client: SupabaseClient) {}

  private async count(
    fn: "rate_limit_hit" | "rate_limit_peek",
    bucket: Bucket,
    subjectHash: string,
    limit: Limit,
  ): Promise<Counted> {
    const { data, error } = await this.client.rpc(fn, {
      p_bucket: bucket,
      p_subject: subjectHash,
      p_limit: limit.max,
      p_window_seconds: limit.seconds,
    });
    if (error) throw new Error(`${fn}: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as CountedRow | undefined;
    if (!row) throw new Error(`${fn}: no answer`);
    return { allowed: row.allowed, hits: row.hits, retryAfterSeconds: row.retry_after_seconds };
  }

  hit(bucket: Bucket, subjectHash: string, limit: Limit) {
    return this.count("rate_limit_hit", bucket, subjectHash, limit);
  }

  peek(bucket: Bucket, subjectHash: string, limit: Limit) {
    return this.count("rate_limit_peek", bucket, subjectHash, limit);
  }

  async clear(bucket: Bucket, subjectHash: string): Promise<void> {
    const { error } = await this.client.rpc("rate_limit_clear", {
      p_bucket: bucket,
      p_subject: subjectHash,
    });
    if (error) throw new Error(`rate_limit_clear: ${error.message}`);
  }
}
