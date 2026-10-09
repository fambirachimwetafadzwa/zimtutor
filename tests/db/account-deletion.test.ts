import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from "./harness";
import { seedMiniCurriculum, seedUsers, type TestUsers } from "./fixtures";

/**
 * Deleting an account must leave nothing behind. The application deletes the sign-in identity and
 * relies on the database to remove everything tied to it, so that is what is proved here, against
 * the real schema: a child with a record in every table that can hold one, deleted, and every table
 * searched for any trace of them.
 */
describe.skipIf(!TEST_DATABASE_URL)("deleting an account", () => {
  let db: TestDatabase;
  let u: TestUsers;
  let question: string;
  const sets: string[] = [];

  /** A child with something in every place a child's record can be, and a parent to go with them. */
  async function newParent(label: string): Promise<string> {
    const parent = randomUUID();
    await db.sql`insert into auth.users (id, email, raw_user_meta_data)
                 values (${parent}, ${`${label}-parent@example.test`}, ${db.sql.json({ display_name: `${label} parent` })})`;
    return parent;
  }

  /** A second guardian for a child who already has one. */
  async function coGuardian(label: string, learner: string): Promise<string> {
    const parent = await newParent(label);
    await db.sql`insert into public.guardianships (parent_id, learner_id) values (${parent}, ${learner})`;
    return parent;
  }

  async function family(label: string) {
    const sql = db.sql;
    const parent = await newParent(label);
    const learner = randomUUID();
    await sql`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
              values (${learner}, ${`${label}@learners.zimtutor.invalid`}, ${sql.json({ display_name: label })}, ${sql.json({ role: "student" })})`;
    await sql`insert into public.learner_profiles (profile_id, grade, username, created_by)
              values (${learner}, 3, ${label}, ${parent})`;
    await sql`insert into public.guardianships (parent_id, learner_id) values (${parent}, ${learner})`;

    const session = randomUUID();
    await sql`insert into public.tutor_sessions (id, learner_id, objective_id, status) values (${session}, ${learner}, 'G3-NUM-PLACE-VALUE-001', 'COMPLETED')`;
    const messages = await sql`
      insert into public.tutor_messages (session_id, learner_id, role, kind, content, flagged, question_id)
      values (${session}, ${learner}, 'learner', 'LEARNER_MESSAGE', ${`${label} wrote this`}, true, null),
             (${session}, ${learner}, 'tutor', 'EXPLAIN', 'a tutor message', false, null),
             (${session}, ${learner}, 'tutor', 'QUESTION', 'a question', false, ${question})
      returning id, flagged`;
    const flagged = messages.find((m) => m.flagged)!.id as string;
    await sql`insert into public.safety_reviews (message_id, reviewed_by, outcome, note)
              values (${flagged}, ${u.admin}, 'NO_CONCERN', 'checked')`;
    // what an administrator's review writes: the message's id, never its words
    await sql`insert into public.admin_audit_log (admin_id, action, entity_type, entity_id, after_state)
              values (${u.admin}, 'SAFETY_REVIEWED', 'tutor_message', ${flagged}, ${sql.json({ outcome: "NO_CONCERN" })})`;
    await sql`insert into public.learner_objective_mastery (learner_id, objective_id, attempts, correct_attempts, incorrect_attempts, mastery_score)
              values (${learner}, 'G3-NUM-PLACE-VALUE-001', 3, 2, 1, 0.5)`;
    await sql`insert into public.mastery_events (learner_id, objective_id, question_id, evidence, score_before, score_after, state_before, state_after, reason)
              values (${learner}, 'G3-NUM-PLACE-VALUE-001', ${question}, 1, 0.1, 0.3, 'INTRODUCED', 'LEARNING', 'correct')`;
    await sql`insert into public.question_attempts (learner_id, session_id, question_id, objective_id, answer, is_correct, marking_method)
              values (${learner}, ${session}, ${question}, 'G3-NUM-PLACE-VALUE-001', ${sql.json({ value: 50 })}, true, 'EXACT_NUMERIC'),
                     (${learner}, null, ${question}, 'G3-NUM-PLACE-VALUE-001', ${sql.json({ value: 5 })}, false, 'EXACT_NUMERIC')`;
    const [paper] = await sql`
      select public.exam_start(${learner}::uuid, ${sql.json({
        kind: "EXAM_STYLE_PAPER_1",
        grade: 3,
        paper_number: 1,
        paper_length: "SHORT",
        target_proportions: { KNOWLEDGE_COMPREHENSION: 100 },
        achieved_proportions: { KNOWLEDGE_COMPREHENSION: 100 },
        marks_available: 1,
        recommended_minutes: 60,
        plan: {},
      } as never)}, ${sql.json([
        {
          position: 1,
          question_id: question,
          marks: 1,
          skill: "KNOWLEDGE_COMPREHENSION",
          section: "A",
          question_number: 1,
          part: 1,
        },
      ] as never)}) as id`;
    sets.push(paper!.id as string);
    return { parent, learner, session, flagged, paper: paper!.id as string };
  }

  /** Every table in the application's schema (and the sign-in tables) that mentions this id anywhere. */
  async function tablesMentioning(sql: Sql, id: string): Promise<string[]> {
    const tables = await sql`
      select table_schema || '.' || table_name as name
      from information_schema.tables
      where table_type = 'BASE TABLE' and table_schema in ('public', 'auth')
      order by 1`;
    const found: string[] = [];
    for (const { name } of tables) {
      const [row] = await sql.unsafe(
        `select count(*)::int as n from ${name} t where t::text like $1`,
        [`%${id}%`],
      );
      if ((row!.n as number) > 0) found.push(name as string);
    }
    return found;
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedMiniCurriculum(db.sql);
    u = await seedUsers(db.sql);
    const [q] = await db.sql`
      insert into public.questions (learning_objective_id, grade, topic_code, subtopic_id, difficulty, question_type, stem, marking_method, source_type, generator, content_hash)
      values ('G3-NUM-PLACE-VALUE-001', 3, 'NUM', 'G3-NUM-PLACE-VALUE', 1, 'NUMERIC', 'What is 2 + 1?', 'EXACT_NUMERIC', 'SUPPLEMENTAL', 'test', 'deletion-q')
      returning id`;
    question = q!.id as string;
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("is looking at a real record: a child has something in many tables before they go", async () => {
    const f = await family("before");
    const before = await tablesMentioning(db.sql, f.learner);
    for (const table of [
      "auth.users",
      "public.profiles",
      "public.learner_profiles",
      "public.guardianships",
      "public.tutor_sessions",
      "public.tutor_messages",
      "public.learner_objective_mastery",
      "public.mastery_events",
      "public.question_attempts",
      "public.assessment_sets",
    ])
      expect(before, `before deleting: ${table}`).toContain(table);
  });

  it("removes every trace of a child when their sign-in identity is deleted", async () => {
    const mine = await family("gone");
    const other = await family("stays");
    await db.sql`delete from auth.users where id = ${mine.learner}`;

    // nothing anywhere mentions the child, their session or their paper (the audit log's note that a
    // message was reviewed, which names only the message, is looked at on its own below)
    for (const id of [mine.learner, mine.session, mine.paper])
      expect(await tablesMentioning(db.sql, id), `a trace of ${id}`).toEqual([]);

    // another family's child is exactly as it was
    for (const id of [other.learner, other.session, other.paper]) {
      expect(
        (await tablesMentioning(db.sql, id)).length,
        `${id} lost its records`,
      ).toBeGreaterThanOrEqual(1);
    }
    const [attempts] =
      await db.sql`select count(*)::int as n from public.question_attempts where learner_id = ${other.learner}`;
    expect(attempts!.n).toBe(2);
  });

  it("leaves nothing in any table that has a learner column, which a table added later would have to honour too", async () => {
    const f = await family("columns");
    await db.sql`delete from auth.users where id = ${f.learner}`;
    const columns = await db.sql`
      select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and c.column_name in ('learner_id', 'profile_id')`;
    // the check is looking at the tables that hold a child's work
    expect(columns.length).toBeGreaterThanOrEqual(8);
    for (const { table_name, column_name } of columns) {
      const [row] = await db.sql.unsafe(
        `select count(*)::int as n from public."${table_name}" where "${column_name}" = $1`,
        [f.learner] as never,
      );
      expect(row!.n, `${table_name}.${column_name} still has the child`).toBe(0);
    }
  });

  it("keeps the record that a safeguarding message was reviewed, without the child, their words or their id", async () => {
    const f = await family("review");
    const [audited] =
      await db.sql`select count(*)::int as n from public.admin_audit_log where entity_id = ${f.flagged}`;
    expect(audited!.n).toBe(1);
    await db.sql`delete from auth.users where id = ${f.learner}`;
    // the decision stays on record (who, when, the outcome); what it was about is gone
    const kept =
      await db.sql`select action, entity_id, after_state from public.admin_audit_log where entity_id = ${f.flagged}`;
    expect(kept).toHaveLength(1);
    expect(JSON.stringify(kept)).not.toContain(f.learner);
    expect(JSON.stringify(kept)).not.toContain("review wrote this");
    expect(await db.sql`select 1 from public.tutor_messages where id = ${f.flagged}`).toHaveLength(
      0,
    );
  });

  it("removes a parent and, when the children go first as the application does, the whole family", async () => {
    const f = await family("whole");
    await db.sql`delete from auth.users where id = ${f.learner}`;
    await db.sql`delete from auth.users where id = ${f.parent}`;
    for (const id of [f.parent, f.learner, f.session, f.paper])
      expect(await tablesMentioning(db.sql, id), `a trace of ${id}`).toEqual([]);
  });

  it("leaves a child who has another guardian with that guardian when one parent goes", async () => {
    const f = await family("shared");
    const second = await coGuardian("shared-second", f.learner);
    await db.sql`delete from auth.users where id = ${f.parent}`;
    expect(await tablesMentioning(db.sql, f.parent)).toEqual([]);
    const guardians =
      await db.sql`select parent_id from public.guardianships where learner_id = ${f.learner}`;
    expect(guardians.map((g) => g.parent_id)).toEqual([second]);
    // and the child's work is untouched
    const [sessions] =
      await db.sql`select count(*)::int as n from public.tutor_sessions where learner_id = ${f.learner}`;
    expect(sessions!.n).toBe(1);
  });
});
