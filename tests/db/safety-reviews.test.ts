import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asUser,
  createTestDatabase,
  expectPgError,
  TEST_DATABASE_URL,
  type TestDatabase,
} from "./harness";
import { seedMiniCurriculum, seedUsers, type TestUsers } from "./fixtures";

describe.skipIf(!TEST_DATABASE_URL)("safety reviews", () => {
  let db: TestDatabase;
  let u: TestUsers;
  let flagged: string;
  let ordinary: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedMiniCurriculum(db.sql);
    u = await seedUsers(db.sql);
    const session = randomUUID();
    await db.sql`insert into public.tutor_sessions (id, learner_id, objective_id) values (${session}, ${u.learnerA}, 'G3-NUM-PLACE-VALUE-001')`;
    const rows = await db.sql`
      insert into public.tutor_messages (session_id, learner_id, role, kind, content, flagged)
      values (${session}, ${u.learnerA}, 'learner', 'LEARNER_MESSAGE', 'my number is [removed]', true),
             (${session}, ${u.learnerA}, 'learner', 'LEARNER_MESSAGE', 'why do we carry the one?', false)
      returning id, flagged`;
    flagged = rows.find((r) => r.flagged)!.id as string;
    ordinary = rows.find((r) => !r.flagged)!.id as string;
    await db.sql`insert into public.safety_reviews (message_id, reviewed_by, outcome, note)
                 values (${flagged}, ${u.admin}, 'NO_CONCERN', 'a phone number, removed')`;
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("can be read by an administrator and by nobody else", async () => {
    await asUser(db.sql, { userId: u.admin }, async (tx) => {
      expect(
        (await tx`select message_id from public.safety_reviews`).map((r) => r.message_id),
      ).toEqual([flagged]);
    });
    for (const who of [u.parentA, u.parentB, u.learnerA, u.learnerB]) {
      await asUser(db.sql, { userId: who }, async (tx) => {
        expect(await tx`select message_id from public.safety_reviews`).toHaveLength(0);
      });
    }
    await asUser(db.sql, "anon", async (tx) => {
      await expectPgError(tx`select message_id from public.safety_reviews`);
    });
  });

  it("can be written by nobody who is not the server, administrators included", async () => {
    // one statement per transaction: a refused statement aborts the one it ran in
    for (const who of [u.admin, u.parentA, u.learnerA]) {
      await asUser(db.sql, { userId: who }, async (tx) => {
        await expectPgError(
          tx`insert into public.safety_reviews (message_id, outcome) values (${ordinary}, 'NO_CONCERN')`,
        );
      });
      await asUser(db.sql, { userId: who }, async (tx) => {
        await expectPgError(tx`update public.safety_reviews set outcome = 'ACTION_TAKEN'`);
      });
      await asUser(db.sql, { userId: who }, async (tx) => {
        await expectPgError(tx`delete from public.safety_reviews`);
      });
    }
  });

  it("allows only the two outcomes and a bounded note", async () => {
    await expect(
      db.sql`insert into public.safety_reviews (message_id, outcome) values (${ordinary}, 'IGNORED')`,
    ).rejects.toThrow();
    await expect(
      db.sql`insert into public.safety_reviews (message_id, outcome, note) values (${ordinary}, 'NO_CONCERN', ${"x".repeat(1001)})`,
    ).rejects.toThrow();
  });

  it("goes when its message goes", async () => {
    const id = randomUUID();
    const [session] = await db.sql`select id from public.tutor_sessions limit 1`;
    await db.sql`insert into public.tutor_messages (id, session_id, learner_id, role, kind, content, flagged)
                 values (${id}, ${session!.id}, ${u.learnerA}, 'learner', 'LEARNER_MESSAGE', 'x', true)`;
    await db.sql`insert into public.safety_reviews (message_id, outcome) values (${id}, 'NO_CONCERN')`;
    await db.sql`delete from public.tutor_messages where id = ${id}`;
    expect(await db.sql`select 1 from public.safety_reviews where message_id = ${id}`).toHaveLength(
      0,
    );
  });
});
