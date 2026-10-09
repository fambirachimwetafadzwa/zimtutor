import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createLimiter } from "../../src/lib/ratelimit/limiter";
import { LIMITS } from "../../src/lib/ratelimit/policy";
import { SupabaseRateLimitPort } from "../../src/lib/ratelimit/store";
import { subjectHash } from "../../src/lib/ratelimit/subject";

/** The counters, through the real API: the server can use them, nobody else can touch them. */

const URL = process.env.INTEGRATION_SUPABASE_URL;
const ANON = process.env.INTEGRATION_SUPABASE_ANON_KEY;
const SERVICE = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL && ANON && SERVICE);
const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const PASSWORD = "correct horse battery staple";
const run = Date.now().toString(36);

describe.skipIf(!configured)("rate limits (real API)", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;
  let parent: SupabaseClient;

  beforeAll(async () => {
    service = createClient(URL!, SERVICE!, options);
    anon = createClient(URL!, ANON!, options);
    parent = createClient(URL!, ANON!, options);
    const { error } = await parent.auth.signUp({
      email: `ratelimit-${run}@example.test`,
      password: PASSWORD,
    });
    if (error) throw error;
  });

  const args = (subject: string) => ({
    p_bucket: "tutor.ask",
    p_subject: subject,
    p_limit: 3,
    p_window_seconds: 60,
  });

  it("cannot be called, or read, by the browser's keys", async () => {
    for (const [who, client] of [
      ["no one", anon],
      ["a parent", parent],
    ] as const) {
      for (const fn of ["rate_limit_hit", "rate_limit_peek"] as const) {
        const { error } = await client.rpc(
          fn,
          args(subjectHash("x", "tutor.ask", `${run}-${who}`)),
        );
        expect(error?.code, `${who} calling ${fn}`).toBe("42501");
      }
      const cleared = await client.rpc("rate_limit_clear", {
        p_bucket: "tutor.ask",
        p_subject: subjectHash("x", "tutor.ask", run),
      });
      expect(cleared.error?.code, `${who} clearing`).toBe("42501");
      const read = await client.from("rate_limit_counters").select("*");
      expect(read.error?.code, `${who} reading`).toBe("42501");
      const written = await client.from("rate_limit_counters").insert({
        bucket: "tutor.ask",
        subject_hash: "z".repeat(20),
        window_start: new Date(),
        hits: 0,
      });
      expect(written.error?.code, `${who} writing`).toBe("42501");
    }
  });

  it("counts for the server: allowed up to the limit, then refused, then forgotten on request", async () => {
    const limiter = createLimiter({
      port: new SupabaseRateLimitPort(service),
      hash: (bucket, subject) => subjectHash("integration secret", bucket, subject),
      onError: (error) => {
        throw error;
      },
    });
    const subject = `learner-${run}`;
    const bucket = "exam.start";
    const verdicts = [];
    for (let i = 0; i < LIMITS[bucket].max + 2; i++)
      verdicts.push(await limiter.hit(bucket, subject));
    expect(verdicts.filter((v) => v.allowed)).toHaveLength(LIMITS[bucket].max);
    const refused = verdicts.at(-1)!;
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.retryAfterSeconds).toBeGreaterThan(0);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(LIMITS[bucket].seconds);
    }
    expect((await limiter.peek(bucket, subject)).allowed).toBe(false);
    expect((await limiter.hit(bucket, `someone-else-${run}`)).allowed).toBe(true);

    await limiter.clear(bucket, subject);
    expect((await limiter.peek(bucket, subject)).allowed).toBe(true);
    expect((await limiter.hit(bucket, subject)).allowed).toBe(true);
  });

  it("keeps only hashes: nothing in the table says who was counted", async () => {
    const hash = subjectHash("integration secret", "login.account", `learner:chipo-${run}`);
    const port = new SupabaseRateLimitPort(service);
    await port.hit("login.account", hash, LIMITS["login.account"]);
    const { data } = await service.from("rate_limit_counters").select("*").eq("subject_hash", hash);
    expect(data).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain("chipo");
    await port.clear("login.account", hash);
  });
});
