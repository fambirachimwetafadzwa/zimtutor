import { LIMITS, refusalFor, type Bucket, type Limit } from "./policy";

/** What the counter says after (or, for a peek, before) a hit. */
export interface Counted {
  allowed: boolean;
  hits: number;
  retryAfterSeconds: number;
}

/** Where the counts are kept: the database in the running application, memory in tests. */
export interface RateLimitPort {
  /** Count one hit and judge it. */
  hit(bucket: Bucket, subjectHash: string, limit: Limit): Promise<Counted>;
  /** Judge without counting. */
  peek(bucket: Bucket, subjectHash: string, limit: Limit): Promise<Counted>;
  /** Forget the count. */
  clear(bucket: Bucket, subjectHash: string): Promise<void>;
}

export type Verdict =
  { allowed: true } | { allowed: false; retryAfterSeconds: number; message: string };

export interface Limiter {
  hit(bucket: Bucket, subject: string): Promise<Verdict>;
  peek(bucket: Bucket, subject: string): Promise<Verdict>;
  clear(bucket: Bucket, subject: string): Promise<void>;
}

export interface LimiterDeps {
  port: RateLimitPort;
  /** Turns the thing being counted into what is stored (a keyed hash; see subject.ts). */
  hash(bucket: Bucket, subject: string): string;
  /** Told when the counters could not be reached. */
  onError(error: unknown, bucket: Bucket): void;
  /** Told whenever a limit is reached (which one, never whose). */
  onRefused?(bucket: Bucket): void;
}

/**
 * Limits, as the rest of the application uses them.
 *
 * If the counters cannot be reached, the answer is YES: a child's lesson, or a parent's sign-in, must
 * not stop because a counter is down (and when the database really is down, nothing else works
 * either). The failure is reported so that it is noticed.
 */
export function createLimiter(deps: LimiterDeps): Limiter {
  const verdict = (bucket: Bucket, counted: Counted): Verdict => {
    if (counted.allowed) return { allowed: true };
    try {
      deps.onRefused?.(bucket);
    } catch {
      // being unable to say so must not change the answer
    }
    return {
      allowed: false,
      retryAfterSeconds: counted.retryAfterSeconds,
      message: refusalFor(bucket, counted.retryAfterSeconds),
    };
  };

  return {
    async hit(bucket, subject) {
      try {
        return verdict(
          bucket,
          await deps.port.hit(bucket, deps.hash(bucket, subject), LIMITS[bucket]),
        );
      } catch (error) {
        deps.onError(error, bucket);
        return { allowed: true };
      }
    },
    async peek(bucket, subject) {
      try {
        return verdict(
          bucket,
          await deps.port.peek(bucket, deps.hash(bucket, subject), LIMITS[bucket]),
        );
      } catch (error) {
        deps.onError(error, bucket);
        return { allowed: true };
      }
    },
    async clear(bucket, subject) {
      try {
        await deps.port.clear(bucket, deps.hash(bucket, subject));
      } catch (error) {
        deps.onError(error, bucket);
      }
    },
  };
}
