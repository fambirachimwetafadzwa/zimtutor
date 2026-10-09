import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, createTestDatabase, expectPgError, TEST_DATABASE_URL } from "./harness";
import type { TestDatabase } from "./harness";
import { seedUsers, type TestUsers } from "./fixtures";

const HASH = (n: number | string) => `h${String(n).padStart(20, "0")}`;
const T0 = "2026-10-08T12:00:00Z";
const at = (seconds: number) => new Date(Date.parse(T0) + seconds * 1000).toISOString();

describe.skipIf(!TEST_DATABASE_URL)("rate limits", () => {
  let db: TestDatabase;
  let u: TestUsers;

  const hit = async (subject: string, limit = 3, window = 60, now = T0, bucket = "tutor.ask") => {
    const [row] = await db.sql`
      select * from public.rate_limit_hit(${bucket}, ${subject}, ${limit}, ${window}, ${now}::timestamptz)`;
    return row as { allowed: boolean; hits: number; retry_after_seconds: number };
  };
  const peek = async (subject: string, limit = 3, window = 60, now = T0, bucket = "tutor.ask") => {
    const [row] = await db.sql`
      select * from public.rate_limit_peek(${bucket}, ${subject}, ${limit}, ${window}, ${now}::timestamptz)`;
    return row as { allowed: boolean; hits: number; retry_after_seconds: number };
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    u = await seedUsers(db.sql);
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("counts hits, allows up to the limit, and refuses after it", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await hit(HASH("a")));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((r) => r.hits)).toEqual([1, 2, 3, 4, 5]);
  });

  it("says how long is left in the window, and never extends it", async () => {
    // 12:00:00 is on a minute boundary: a 60 s window ends at 12:01:00
    expect((await hit(HASH("t"), 1, 60, at(0))).retry_after_seconds).toBe(60);
    expect((await hit(HASH("t"), 1, 60, at(45))).retry_after_seconds).toBe(15);
    expect((await hit(HASH("t"), 1, 60, at(59.5))).retry_after_seconds).toBe(1);
    // hits beyond the limit do not push the end of the window out
    expect((await hit(HASH("t"), 1, 60, at(59.9))).retry_after_seconds).toBe(1);
  });

  it("aligns windows to the clock, so that every caller agrees where one ends", async () => {
    // a 15-minute window containing 12:07 runs from 12:00 to 12:15
    const [row] = await db.sql`
      select public.rate_limit_window(${at(7 * 60)}::timestamptz, 900) as w`;
    expect(new Date(row!.w as string).toISOString()).toBe("2026-10-08T12:00:00.000Z");
    const [next] = await db.sql`
      select public.rate_limit_window(${at(15 * 60)}::timestamptz, 900) as w`;
    expect(new Date(next!.w as string).toISOString()).toBe("2026-10-08T12:15:00.000Z");
  });

  it("starts a fresh count in the next window", async () => {
    for (let i = 0; i < 4; i++) await hit(HASH("w"), 3, 60, at(10));
    expect((await hit(HASH("w"), 3, 60, at(20))).allowed).toBe(false);
    const later = await hit(HASH("w"), 3, 60, at(70));
    expect(later).toMatchObject({ allowed: true, hits: 1 });
  });

  it("counts each subject and each bucket on its own", async () => {
    for (let i = 0; i < 5; i++) await hit(HASH("s1"));
    expect((await hit(HASH("s1"))).allowed).toBe(false);
    expect((await hit(HASH("s2"))).allowed).toBe(true);
    expect((await hit(HASH("s1"), 3, 60, T0, "tutor.step")).allowed).toBe(true);
  });

  it("is exact when a crowd arrives at once", async () => {
    // 40 requests in flight on 4 connections, limit 10: exactly 10 get through
    const verdicts = await Promise.all(
      Array.from({ length: 40 }, () => hit(HASH("crowd"), 10, 3600, T0, "exam.start")),
    );
    expect(verdicts.filter((v) => v.allowed)).toHaveLength(10);
    expect(Math.max(...verdicts.map((v) => v.hits))).toBe(40);
    expect(new Set(verdicts.map((v) => v.hits)).size).toBe(40); // nobody was given the same count twice
  });

  it("can judge without counting", async () => {
    expect(await peek(HASH("p"))).toMatchObject({ allowed: true, hits: 0 });
    await hit(HASH("p"));
    await hit(HASH("p"));
    expect(await peek(HASH("p"))).toMatchObject({ allowed: true, hits: 2 });
    await hit(HASH("p"));
    expect(await peek(HASH("p"))).toMatchObject({ allowed: false, hits: 3 });
    // looking never changes the answer
    expect(await peek(HASH("p"))).toMatchObject({ allowed: false, hits: 3 });
    // another window: nothing counted there
    expect(await peek(HASH("p"), 3, 60, at(61))).toMatchObject({ allowed: true, hits: 0 });
  });

  it("forgets a subject in one bucket only", async () => {
    await hit(HASH("c"), 3, 60, T0, "login.account");
    await hit(HASH("c"), 3, 60, T0, "login.address");
    await db.sql`select public.rate_limit_clear('login.account', ${HASH("c")})`;
    expect(await peek(HASH("c"), 3, 60, T0, "login.account")).toMatchObject({ hits: 0 });
    expect(await peek(HASH("c"), 3, 60, T0, "login.address")).toMatchObject({ hits: 1 });
  });

  it("sweeps counters from windows that ended more than two days ago, and no others", async () => {
    await hit(HASH("old"), 3, 60, at(-3 * 24 * 3600));
    await hit(HASH("recent"), 3, 60, at(-1 * 24 * 3600));
    const [{ removed }] =
      (await db.sql`select public.rate_limit_sweep(${T0}::timestamptz) as removed`) as unknown as [
        { removed: number },
      ];
    expect(removed).toBeGreaterThanOrEqual(1);
    const left =
      await db.sql`select subject_hash from public.rate_limit_counters where subject_hash in (${HASH("old")}, ${HASH("recent")})`;
    expect(left.map((r) => r.subject_hash)).toEqual([HASH("recent")]);
  });

  it("refuses a limit or a window that makes no sense", async () => {
    await expect(hit(HASH("bad"), 0)).rejects.toThrow(/positive/);
    await expect(hit(HASH("bad"), 3, 0)).rejects.toThrow(/positive/);
    await expect(peek(HASH("bad"), -1)).rejects.toThrow(/positive/);
  });

  it("refuses names and hashes of a shape the application never uses", async () => {
    await expect(hit(HASH("ok"), 3, 60, T0, "Not A Bucket")).rejects.toThrow();
    await expect(hit("short", 3, 60, T0)).rejects.toThrow();
    await expect(hit("x".repeat(129), 3, 60, T0)).rejects.toThrow();
  });

  describe("who may use it", () => {
    it("is the server's alone: nobody signed in, an administrator included, can call or read it", async () => {
      const callers = [
        { userId: u.admin },
        { userId: u.parentA },
        { userId: u.learnerA },
        "anon",
      ] as const;
      for (const who of callers) {
        await asUser(db.sql, who, async (tx) => {
          await expectPgError(
            tx`select * from public.rate_limit_hit('tutor.ask', ${HASH("x")}, 3, 60)`,
          );
        });
        await asUser(db.sql, who, async (tx) => {
          await expectPgError(
            tx`select * from public.rate_limit_peek('tutor.ask', ${HASH("x")}, 3, 60)`,
          );
        });
        await asUser(db.sql, who, async (tx) => {
          await expectPgError(tx`select public.rate_limit_clear('tutor.ask', ${HASH("x")})`);
        });
        await asUser(db.sql, who, async (tx) => {
          await expectPgError(tx`select public.rate_limit_sweep()`);
        });
        await asUser(db.sql, who, async (tx) => {
          await expectPgError(tx`select * from public.rate_limit_counters`);
        });
        await asUser(db.sql, who, async (tx) => {
          await expectPgError(
            tx`insert into public.rate_limit_counters (bucket, subject_hash, window_start, hits) values ('tutor.ask', ${HASH("y")}, now(), 0)`,
          );
        });
      }
    });

    it("works for the service role", async () => {
      await asService(db.sql, async (tx) => {
        const [row] =
          await tx`select * from public.rate_limit_hit('tutor.ask', ${HASH("svc")}, 3, 60)`;
        expect(row).toMatchObject({ allowed: true, hits: 1 });
        expect(
          await tx`select * from public.rate_limit_counters where subject_hash = ${HASH("svc")}`,
        ).toHaveLength(1);
      });
    });
  });
});
