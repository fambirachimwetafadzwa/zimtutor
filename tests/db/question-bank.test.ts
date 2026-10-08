import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../../src/ingestion/load-db";
import { checkAnswer } from "../../src/lib/questions/answer";
import {
  KEY_COLUMNS,
  QUESTION_COLUMNS,
  storedKeySchema,
  storedQuestionSchema,
  toBankInsert,
  toPublicQuestion,
  toQuestionKey,
} from "../../src/lib/questions/bank-rows";
import { generateQuestion, type VerifiedQuestion } from "../../src/lib/questions/generate";
import { objectivesFromSnapshot } from "../../src/lib/questions/objectives";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import { loadSnapshot as readSnapshot } from "../ingestion/snapshot-fixture";
import { seedUsers } from "./fixtures";
import {
  asService,
  asUser,
  createTestDatabase,
  expectPgError,
  TEST_DATABASE_URL,
  type TestDatabase,
} from "./harness";

/**
 * The question bank against a REAL database with the whole syllabus loaded: the function that stores
 * a generated question and its key, what it refuses, who may call it, and the round trip from a
 * generated question through the tables back to marking.
 */

const snapshot = readSnapshot();
const OBJECTIVES = objectivesFromSnapshot(snapshot);
const objective = OBJECTIVES.find((o) => o.id === "G4-OPS-ADDITION-WHOLE-NUMBERS-001")!;

const make = (seed = "db", difficulty: 1 | 2 | 3 | 4 | 5 = 3, o = objective): VerifiedQuestion =>
  generateQuestion({ objective: o, difficulty, seed, templates: ALL_TEMPLATES });

describe.skipIf(!TEST_DATABASE_URL)("question bank in the database", () => {
  let db: TestDatabase;
  let users: Awaited<ReturnType<typeof seedUsers>>;

  const save = (q: VerifiedQuestion, patch: Record<string, unknown> = {}) => {
    const { question, key } = toBankInsert(q);
    return db.sql<Array<{ id: string }>>`
      select public.bank_save_question(${db.sql.json({ ...question, ...patch })}, ${db.sql.json(key as never)}) as id`;
  };

  const saveId = async (q: VerifiedQuestion, patch: Record<string, unknown> = {}) =>
    (await save(q, patch))[0]!.id;

  beforeAll(async () => {
    db = await createTestDatabase();
    await loadSnapshot(db.sql, snapshot);
    users = await seedUsers(db.sql);
  }, 120_000);
  afterAll(async () => db?.drop());

  it("stores a question and its key together, labelled as unverified supplemental practice", async () => {
    const q = make("first");
    const id = await saveId(q);
    const [row] = await db.sql`select * from public.questions where id = ${id}`;
    expect(row).toMatchObject({
      learning_objective_id: objective.id,
      grade: 4,
      topic_code: "OPS",
      difficulty: 3,
      source_type: "SUPPLEMENTAL",
      verification_status: "UNVERIFIED",
      status: "ACTIVE",
      content_hash: q.contentHash,
      generator: `template:${q.templateId}@${q.templateVersion}`,
      generator_seed: q.seed,
    });
    const [key] = await db.sql`select * from public.question_keys where question_id = ${id}`;
    expect(key?.explanation).toBe(q.explanation);
    expect(key?.hints).toEqual(q.hints);
    expect(key?.expected_answer).toEqual({ spec: q.marking, display: q.correctAnswer });
  });

  it("stores the same content once and returns the same id", async () => {
    const q = make("twice");
    const [a] = await save(q);
    const [b] = await save(q);
    expect(b!.id).toBe(a!.id);
    const [counted] = await db.sql<Array<{ n: number }>>`
      select count(*)::int as n from public.questions where content_hash = ${q.contentHash}`;
    expect(counted?.n).toBe(1);
    const [keys] = await db.sql<Array<{ k: number }>>`
      select count(*)::int as k from public.question_keys where question_id = ${a!.id}`;
    expect(keys?.k).toBe(1);
  });

  it("refuses to label a generated question official or verified from the source", async () => {
    await expectPgError(save(make("official-1"), { source_type: "OFFICIAL_CURRICULUM" }), "23514");
    await expectPgError(save(make("official-2"), { source_type: "OFFICIAL_ASSESSMENT" }), "23514");
    await expectPgError(
      save(make("verified"), { verification_status: "VERIFIED_FROM_SOURCE" }),
      "23514",
    );
  });

  it("refuses a question for an unknown objective, without a generator, or with an unknown misconception", async () => {
    await expectPgError(
      save(make("unknown-objective"), { learning_objective_id: "G9-NOPE-001" }),
      "23503",
    );
    await expectPgError(save(make("no-generator"), { generator: "" }), "23514");
    await expectPgError(
      save(make("bad-tag"), { misconception_tags: ["NOT_A_MISCONCEPTION"] }),
      "23514",
    );
  });

  it("can be called by the server only", async () => {
    const q = make("privileges");
    const { question, key } = toBankInsert(q);
    await expectPgError(
      asUser(
        db.sql,
        { userId: users.learnerA },
        (tx) =>
          tx`select public.bank_save_question(${tx.json(question as never)}, ${tx.json(key as never)})`,
      ),
    );
    await expectPgError(
      asUser(
        db.sql,
        "anon",
        (tx) =>
          tx`select public.bank_save_question(${tx.json(question as never)}, ${tx.json(key as never)})`,
      ),
    );
    await expectPgError(
      asUser(
        db.sql,
        { userId: users.admin },
        (tx) =>
          tx`select public.bank_save_question(${tx.json(question as never)}, ${tx.json(key as never)})`,
      ),
    );
    const [saved] = await asService(
      db.sql,
      (tx) =>
        tx<
          Array<{ id: string }>
        >`select public.bank_save_question(${tx.json(question as never)}, ${tx.json(key as never)}) as id`,
    );
    expect(saved?.id).toBeTruthy();
  });

  it("keeps questions from learners and parents, and keys from everyone but the server", async () => {
    const id = await saveId(make("visibility"));
    for (const actor of [users.learnerA, users.parentA]) {
      const questions = await asUser(
        db.sql,
        { userId: actor },
        (tx) => tx`select id from public.questions where id = ${id}`,
      );
      expect(questions).toHaveLength(0);
      await expectPgError(
        asUser(
          db.sql,
          { userId: actor },
          (tx) => tx`select expected_answer from public.question_keys`,
        ),
      );
    }
    // an administrator may review questions, but never reads the key with a session of their own
    const asAdmin = await asUser(
      db.sql,
      { userId: users.admin },
      (tx) => tx`select id from public.questions where id = ${id}`,
    );
    expect(asAdmin).toHaveLength(1);
    await expectPgError(
      asUser(
        db.sql,
        { userId: users.admin },
        (tx) => tx`select expected_answer from public.question_keys`,
      ),
    );
  });

  it("round-trips questions from every template through the tables back to marking", async () => {
    const failures: string[] = [];
    let saved = 0;
    for (const template of ALL_TEMPLATES) {
      const objectives = OBJECTIVES.filter((o) => template.covers(o));
      const o = objectives[Math.floor(objectives.length / 2)]!;
      const difficulty = (template.levels?.[0] ?? 3) as 1 | 2 | 3 | 4 | 5;
      const q = generateQuestion({
        objective: o,
        difficulty,
        seed: "db-round-trip",
        templates: ALL_TEMPLATES,
        templateId: template.id,
      });
      const id = await saveId(q);
      saved++;
      const [questionRow] = await db.sql.unsafe(
        `select ${QUESTION_COLUMNS} from public.questions where id = '${id}'`,
      );
      const [keyRow] = await db.sql.unsafe(
        `select ${KEY_COLUMNS} from public.question_keys where question_id = '${id}'`,
      );
      const stored = storedQuestionSchema.parse(questionRow);
      const key = toQuestionKey(stored, storedKeySchema.parse(keyRow));
      const where = `${template.id} (${o.id})`;
      if (!checkAnswer(key, key.display).result.correct)
        failures.push(`${where}: the stored key rejects its own answer`);
      const view = toPublicQuestion(stored);
      if (view.stem !== q.stem) failures.push(`${where}: the stem changed`);
      if (JSON.stringify(view.options ?? null) !== JSON.stringify(q.options ?? null))
        failures.push(`${where}: the options changed`);
      if (JSON.stringify(view.items ?? null) !== JSON.stringify(q.items ?? null))
        failures.push(`${where}: the items changed`);
      if (JSON.stringify(view.stemData ?? null) !== JSON.stringify(q.stemData ?? null))
        failures.push(`${where}: the picture changed`);
    }
    expect(saved).toBe(ALL_TEMPLATES.length);
    expect(failures.slice(0, 8), `${failures.length} failure(s)`).toEqual([]);
  }, 120_000);
});
