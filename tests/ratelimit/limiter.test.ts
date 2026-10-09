import { describe, expect, it } from "vitest";
import { createLimiter, type RateLimitPort } from "../../src/lib/ratelimit/limiter";
import { MemoryRateLimitPort } from "../../src/lib/ratelimit/memory";
import { LIMITS, type Bucket } from "../../src/lib/ratelimit/policy";
import { subjectHash } from "../../src/lib/ratelimit/subject";

/** A limiter over memory with a clock the test moves. */
function setup() {
  const clock = { now: Date.UTC(2026, 9, 8, 12, 0, 0) };
  const port = new MemoryRateLimitPort(() => clock.now);
  const errors: Array<{ bucket: Bucket; error: unknown }> = [];
  const limiter = createLimiter({
    port,
    hash: (bucket, subject) => subjectHash("test secret", bucket, subject),
    onError: (error, bucket) => errors.push({ error, bucket }),
  });
  return { clock, port, limiter, errors };
}

describe("a limiter", () => {
  it("lets through as many hits as the limit allows and refuses the next", async () => {
    const { limiter } = setup();
    const max = LIMITS["tutor.ask"].max;
    for (let i = 0; i < max; i++)
      expect(await limiter.hit("tutor.ask", "learner-1"), `hit ${i + 1}`).toEqual({
        allowed: true,
      });
    const refused = await limiter.hit("tutor.ask", "learner-1");
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(LIMITS["tutor.ask"].seconds);
      expect(refused.message).toContain("going a little fast");
    }
    // and goes on refusing until the window is over
    expect((await limiter.hit("tutor.ask", "learner-1")).allowed).toBe(false);
  });

  it("starts again when the window is over", async () => {
    const { limiter, clock } = setup();
    for (let i = 0; i < LIMITS["tutor.ask"].max + 3; i++)
      await limiter.hit("tutor.ask", "learner-1");
    expect((await limiter.hit("tutor.ask", "learner-1")).allowed).toBe(false);
    clock.now += LIMITS["tutor.ask"].seconds * 1000;
    expect(await limiter.hit("tutor.ask", "learner-1")).toEqual({ allowed: true });
  });

  it("counts each person, and each kind of thing, on its own", async () => {
    const { limiter } = setup();
    for (let i = 0; i < LIMITS["tutor.ask"].max + 5; i++)
      await limiter.hit("tutor.ask", "learner-1");
    expect((await limiter.hit("tutor.ask", "learner-1")).allowed).toBe(false);
    expect((await limiter.hit("tutor.ask", "learner-2")).allowed).toBe(true);
    expect((await limiter.hit("tutor.step", "learner-1")).allowed).toBe(true);
  });

  it("tells how long is left in the window, never more than the window", async () => {
    const { limiter, clock } = setup();
    const bucket: Bucket = "login.account";
    const { max, seconds } = LIMITS[bucket];
    // move to 100 seconds before the end of a window
    clock.now = (Math.floor(clock.now / 1000 / seconds) * seconds + seconds - 100) * 1000;
    for (let i = 0; i < max; i++) await limiter.hit(bucket, "x");
    const refused = await limiter.hit(bucket, "x");
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) expect(refused.retryAfterSeconds).toBe(100);
  });

  it("can judge without counting (for limits that only failures count against)", async () => {
    const { limiter } = setup();
    const max = LIMITS["login.address"].max;
    for (let i = 0; i < 1000; i++)
      expect((await limiter.peek("login.address", "1.2.3.4")).allowed).toBe(true);
    for (let i = 0; i < max - 1; i++) await limiter.hit("login.address", "1.2.3.4");
    expect((await limiter.peek("login.address", "1.2.3.4")).allowed).toBe(true);
    await limiter.hit("login.address", "1.2.3.4");
    // the count has reached the limit: nothing more may be tried from here
    const verdict = await limiter.peek("login.address", "1.2.3.4");
    expect(verdict.allowed).toBe(false);
  });

  it("forgets a count when told to (a good sign-in ends the wrong guesses)", async () => {
    const { limiter } = setup();
    for (let i = 0; i < LIMITS["login.account"].max + 2; i++)
      await limiter.hit("login.account", "a");
    expect((await limiter.hit("login.account", "a")).allowed).toBe(false);
    await limiter.clear("login.account", "a");
    expect(await limiter.hit("login.account", "a")).toEqual({ allowed: true });
  });

  it("does not let the same email in another case dodge the count", async () => {
    const { limiter } = setup();
    for (let i = 0; i < LIMITS["login.account"].max; i++)
      await limiter.hit("login.account", i % 2 ? "Parent@Example.test" : "parent@example.test");
    expect((await limiter.hit("login.account", "PARENT@example.test")).allowed).toBe(false);
  });

  it("keeps nothing that names anyone", async () => {
    const stored: string[] = [];
    const spy: RateLimitPort = {
      hit: async (bucket, hash, limit) => (
        stored.push(hash),
        { allowed: true, hits: 1, retryAfterSeconds: limit.seconds }
      ),
      peek: async (bucket, hash, limit) => (
        stored.push(hash),
        { allowed: true, hits: 0, retryAfterSeconds: limit.seconds }
      ),
      clear: async (bucket, hash) => void stored.push(hash),
    };
    const limiter = createLimiter({
      port: spy,
      hash: (bucket, subject) => subjectHash("test secret", bucket, subject),
      onError: () => {},
    });
    const names = ["learner:chipo", "parent:mrs.chuma@example.test", "41.220.10.5"];
    for (const name of names) {
      await limiter.hit("login.account", name);
      await limiter.peek("login.address", name);
      await limiter.clear("login.account", name);
    }
    expect(stored).toHaveLength(9);
    for (const hash of stored) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      for (const name of names) expect(hash).not.toContain(name);
    }
  });
});

describe("a limiter that is told of refusals", () => {
  it("says which limit was reached, and nothing else, each time", async () => {
    const told: unknown[][] = [];
    const clock = { now: Date.UTC(2026, 9, 8, 12, 0, 0) };
    const limiter = createLimiter({
      port: new MemoryRateLimitPort(() => clock.now),
      hash: (bucket, subject) => subjectHash("s", bucket, subject),
      onError: () => {},
      onRefused: (...args) => told.push(args),
    });
    for (let i = 0; i < LIMITS["tutor.ask"].max; i++) await limiter.hit("tutor.ask", "learner-1");
    expect(told).toEqual([]);
    await limiter.hit("tutor.ask", "learner-1");
    await limiter.hit("tutor.ask", "learner-1");
    expect(told).toEqual([["tutor.ask"], ["tutor.ask"]]);
  });

  it("is not stopped from answering by a hook that fails", async () => {
    const limiter = createLimiter({
      port: new MemoryRateLimitPort(),
      hash: (bucket, subject) => subjectHash("s", bucket, subject),
      onError: () => {},
      onRefused: () => {
        throw new Error("the monitor is down");
      },
    });
    for (let i = 0; i < LIMITS["tutor.ask"].max; i++) await limiter.hit("tutor.ask", "x");
    const refused = await limiter.hit("tutor.ask", "x");
    expect(refused.allowed).toBe(false);
  });
});

describe("a limiter whose counters cannot be reached", () => {
  const broken: RateLimitPort = {
    hit: async () => {
      throw new Error("connection refused");
    },
    peek: async () => {
      throw new Error("connection refused");
    },
    clear: async () => {
      throw new Error("connection refused");
    },
  };

  it("lets people carry on, and says what went wrong", async () => {
    const errors: Bucket[] = [];
    const limiter = createLimiter({
      port: broken,
      hash: (bucket, subject) => subjectHash("s", bucket, subject),
      onError: (_error, bucket) => errors.push(bucket),
    });
    expect(await limiter.hit("tutor.ask", "x")).toEqual({ allowed: true });
    expect(await limiter.peek("login.address", "x")).toEqual({ allowed: true });
    await expect(limiter.clear("login.account", "x")).resolves.toBeUndefined();
    expect(errors).toEqual(["tutor.ask", "login.address", "login.account"]);
  });
});
