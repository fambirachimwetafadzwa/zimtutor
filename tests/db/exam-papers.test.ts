import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asService,
  asUser,
  createTestDatabase,
  expectPgError,
  TEST_DATABASE_URL,
  type TestDatabase,
} from "./harness";
import { seedMiniCurriculum, seedUsers, type TestUsers } from "./fixtures";

describe.skipIf(!TEST_DATABASE_URL)("practice papers in the database", () => {
  let db: TestDatabase;
  let u: TestUsers;
  const questions: string[] = [];

  const set = (over: Record<string, unknown> = {}) => ({
    kind: "EXAM_STYLE_PAPER_1",
    grade: 3,
    paper_number: 1,
    paper_length: "SHORT",
    target_proportions: {
      KNOWLEDGE_COMPREHENSION: 50,
      APPLICATION_ANALYSIS: 40,
      PROBLEM_SOLVING: 10,
    },
    achieved_proportions: {
      KNOWLEDGE_COMPREHENSION: 50,
      APPLICATION_ANALYSIS: 40,
      PROBLEM_SOLVING: 10,
    },
    marks_available: 2,
    recommended_minutes: 60,
    plan: { plan: {}, achieved: {}, shortfalls: [] },
    ...over,
  });
  const items = () =>
    questions.map((id, i) => ({
      position: i + 1,
      question_id: id,
      marks: 1,
      skill: "KNOWLEDGE_COMPREHENSION",
      section: "A",
      question_number: i + 1,
      part: 1,
    }));

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedMiniCurriculum(db.sql);
    u = await seedUsers(db.sql);
    for (const n of [1, 2]) {
      const [q] = await db.sql`
        insert into public.questions (learning_objective_id, grade, topic_code, subtopic_id, difficulty, question_type, stem, marking_method, source_type, generator, content_hash)
        values ('G3-NUM-PLACE-VALUE-001', 3, 'NUM', 'G3-NUM-PLACE-VALUE', 1, 'NUMERIC', ${`What is ${n} + 1?`}, 'EXACT_NUMERIC', 'SUPPLEMENTAL', 'test', ${`exam-q-${n}`})
        returning id`;
      questions.push(q!.id as string);
    }
  });
  afterAll(async () => {
    await db?.drop();
  });

  /** Start a paper as the superuser, so that it stays (the harness rolls back what it runs as a role). */
  const start = (learner: string, over: Record<string, unknown> = {}) =>
    db.sql`select public.exam_start(${learner}::uuid, ${db.sql.json(set(over) as never)}, ${db.sql.json(items() as never)}) as id`;

  it("starts a paper with all its questions in one step, and only the server can", async () => {
    // as the server (inside one transaction, rolled back afterwards): the set and both items arrive together
    const made = await asService(db.sql, async (tx) => {
      const [row] =
        await tx`select public.exam_start(${u.learnerA}::uuid, ${tx.json(set() as never)}, ${tx.json(items() as never)}) as id`;
      const id = row!.id as string;
      const kept =
        await tx`select count(*)::int as n from public.assessment_set_items where set_id = ${id}`;
      const [paper] =
        await tx`select status, paper_number, is_official_zimsec from public.assessment_sets where id = ${id}`;
      return { items: kept[0]!.n, paper };
    });
    expect(made.items).toBe(2);
    expect(made.paper).toMatchObject({
      status: "IN_PROGRESS",
      paper_number: 1,
      is_official_zimsec: false,
    });

    for (const who of [u.learnerA, u.parentA, u.admin]) {
      await asUser(db.sql, { userId: who }, async (tx) => {
        await expectPgError(
          tx`select public.exam_start(${u.learnerB}::uuid, ${tx.json(set() as never)}, ${tx.json(items() as never)})`,
        );
      });
    }
    await asUser(db.sql, "anon", async (tx) => {
      await expectPgError(
        tx`select public.exam_start(${u.learnerB}::uuid, ${tx.json(set() as never)}, ${tx.json(items() as never)})`,
      );
    });
  });

  it("allows one paper in progress per learner, and another once it is finished", async () => {
    const [first] = await start(u.learnerA);
    expect(first!.id).toBeTruthy();
    await expect(start(u.learnerA)).rejects.toMatchObject({ code: "PT409" });
    await db.sql`update public.assessment_sets set status = 'COMPLETED', completed_at = now() where learner_id = ${u.learnerA}`;
    const [row] = await start(u.learnerA);
    expect(row!.id).toBeTruthy();
    // a second paper for someone else is unaffected
    const [other] = await start(u.learnerB);
    expect(other!.id).toBeTruthy();
  });

  it("starts nothing at all when an item is wrong (the paper is all or nothing)", async () => {
    const before = await db.sql`select count(*)::int as n from public.assessment_sets`;
    await db.sql`update public.assessment_sets set status = 'COMPLETED', completed_at = now()`;
    await expect(
      asService(
        db.sql,
        (tx) =>
          tx`select public.exam_start(${u.learnerA}::uuid, ${tx.json(set() as never)}, ${tx.json([{ ...items()[0], question_id: randomUUID() }] as never)})`,
      ),
    ).rejects.toThrow();
    const after = await db.sql`select count(*)::int as n from public.assessment_sets`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it("can never be official ZIMSEC, whatever is written", async () => {
    await expect(
      db.sql`update public.assessment_sets set is_official_zimsec = true`,
    ).rejects.toThrow();
  });

  it("is readable by the learner and their guardian, and by nobody else; written by nobody but the server", async () => {
    await db.sql`update public.assessment_sets set status = 'COMPLETED', completed_at = now() where status = 'IN_PROGRESS'`;
    const [row] = await start(u.learnerA);
    const id = row!.id as string;
    for (const who of [u.learnerA, u.parentA, u.admin]) {
      await asUser(db.sql, { userId: who }, async (tx) => {
        expect(await tx`select id from public.assessment_sets where id = ${id}`).toHaveLength(1);
        expect(
          await tx`select position from public.assessment_set_items where set_id = ${id}`,
        ).toHaveLength(2);
      });
    }
    for (const who of [u.learnerB, u.parentB]) {
      await asUser(db.sql, { userId: who }, async (tx) => {
        expect(await tx`select id from public.assessment_sets where id = ${id}`).toHaveLength(0);
        expect(
          await tx`select position from public.assessment_set_items where set_id = ${id}`,
        ).toHaveLength(0);
      });
    }
    for (const who of [u.learnerA, u.parentA]) {
      await asUser(db.sql, { userId: who }, async (tx) => {
        await expectPgError(
          tx`update public.assessment_set_items set awarded = 1 where set_id = ${id}`,
        );
      });
      await asUser(db.sql, { userId: who }, async (tx) => {
        await expectPgError(
          tx`update public.assessment_sets set marks_awarded = 2 where id = ${id}`,
        );
      });
    }
  });
});
