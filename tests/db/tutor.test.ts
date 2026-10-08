import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSnapshot } from "../../src/ingestion/load-db";
import { applyObservation, newMasteryRecord } from "../../src/lib/mastery/engine";
import { generateQuestion } from "../../src/lib/questions/generate";
import { objectivesFromSnapshot } from "../../src/lib/questions/objectives";
import { ALL_TEMPLATES } from "../../src/lib/questions/templates";
import { createVoice } from "../../src/lib/tutor/voice";
import { act, startOrResume, type TutorDeps } from "../../src/lib/tutor/service";
import { newSessionState } from "../../src/lib/tutor/state";
import {
  ActiveSessionExistsError,
  StepConflictError,
  type SessionRow,
  type StepCommit,
} from "../../src/lib/tutor/store";
import { loadSnapshot as readSnapshot } from "../ingestion/snapshot-fixture";
import { FixtureCurriculum, rightAnswer, wrongAnswer } from "../tutor/learner";
import { seedUsers } from "./fixtures";
import {
  asService,
  asUser,
  createTestDatabase,
  expectPgError,
  TEST_DATABASE_URL,
  type TestDatabase,
} from "./harness";
import { PostgresBankStore, PostgresTutorStore } from "./tutor-stores";

/**
 * The tutor against a REAL database with the whole syllabus loaded: the function that writes a lesson
 * step all-or-nothing, who may call it, who may read what a child said, and a whole lesson run
 * through the same service the app uses.
 */

const snapshot = readSnapshot();
const OBJECTIVES = objectivesFromSnapshot(snapshot);
const GOAL = "G3-OPS-ADDITION-WHOLE-NUMBERS-001";
const OTHER_GOAL = "G3-OPS-SUBTRACTION-WHOLE-NUMBERS-001";
const FLOW_GOAL = "G3-OPS-ADDITION-WHOLE-NUMBERS-002";

describe.skipIf(!TEST_DATABASE_URL)("tutor sessions in the database", () => {
  let db: TestDatabase;
  let users: Awaited<ReturnType<typeof seedUsers>>;
  let store: PostgresTutorStore;
  let bank: PostgresBankStore;

  const questionFor = async (objectiveId: string, seed: string) => {
    const objective = OBJECTIVES.find((o) => o.id === objectiveId)!;
    return bank.save(
      generateQuestion({ objective, difficulty: 2, seed, templates: ALL_TEMPLATES }),
    );
  };

  const open = (learnerId = users.learnerA, objectiveId = GOAL): Promise<SessionRow> =>
    store.createSession({
      learnerId,
      objectiveId,
      phase: "IDENTIFY_OBJECTIVE",
      state: newSessionState({ mode: "LEARN", now: new Date(), masteryStart: null }),
    });

  const step = (s: SessionRow, patch: Partial<StepCommit> = {}): StepCommit => ({
    sessionId: s.id,
    expectedRev: s.rev,
    phase: "LESSON",
    state: s.state,
    status: "ACTIVE",
    messages: [],
    ...patch,
  });

  const attemptFor = (questionId: string, patch = {}) => ({
    questionId,
    objectiveId: GOAL,
    attemptNumber: 1,
    answer: "12",
    isCorrect: true,
    score: 1,
    hintsUsed: 0,
    markingMethod: "EXACT_NUMERIC" as const,
    markingDetail: { status: "CORRECT", signals: [] },
    misconceptionTags: [],
    timeTakenMs: 4200,
    difficulty: 2,
    ...patch,
  });

  const count = async (table: string, where = "true") => {
    const [row] = await db.sql.unsafe(
      `select count(*)::int as n from public.${table} where ${where}`,
    );
    return row!.n as number;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    await loadSnapshot(db.sql, snapshot);
    users = await seedUsers(db.sql);
    store = new PostgresTutorStore(db.sql);
    bank = new PostgresBankStore(db.sql);
  }, 120_000);
  afterAll(async () => db?.drop());

  describe("committing a step", () => {
    it("writes the position, the messages in order, the attempt and the mastery together", async () => {
      const s = await open();
      const qid = await questionFor(GOAL, "commit-1");
      const base = newMasteryRecord(new Date("2026-10-08T08:00:00Z"));
      const { record, event } = applyObservation(base, {
        outcome: "CORRECT",
        difficulty: 2,
        hintsUsed: 0,
        attemptNumber: 1,
        questionType: "NUMERIC",
        at: new Date("2026-10-08T08:01:00Z"),
      });
      const rev = await store.commit(
        step(s, {
          phase: "AWAITING_ANSWER",
          messages: [
            { role: "tutor", kind: "IDENTIFY", content: "one", meta: { source: "template" } },
            { role: "tutor", kind: "QUESTION", content: "two", questionId: qid },
            { role: "learner", kind: "LEARNER_ANSWER", content: "three", questionId: qid },
            { role: "tutor", kind: "FEEDBACK", content: "four", meta: { verdict: "CORRECT" } },
            {
              role: "tutor",
              kind: "TRANSITION",
              content: "five",
              meta: { decision: "NEXT_QUESTION" },
            },
          ],
          attempt: attemptFor(qid),
          mastery: {
            objectiveId: GOAL,
            expectedVersion: null,
            record,
            event: { questionId: qid, event },
          },
        }),
      );
      expect(rev).toBe(1);

      const after = (await store.getSession(s.id))!;
      expect(after).toMatchObject({ rev: 1, phase: "AWAITING_ANSWER", status: "ACTIVE" });
      expect((await store.listMessages(s.id)).map((m) => m.content)).toEqual([
        "one",
        "two",
        "three",
        "four",
        "five",
      ]);
      const messages = await store.listMessages(s.id);
      expect(messages[0]!.meta).toEqual({ source: "template" });
      expect(messages[1]!.questionId).toBe(qid);
      expect(new Set(messages.map((m) => m.seq)).size).toBe(5);

      const [attempt] =
        await db.sql`select * from public.question_attempts where session_id = ${s.id}`;
      expect(attempt).toMatchObject({
        learner_id: users.learnerA,
        question_id: qid,
        objective_id: GOAL,
        attempt_number: 1,
        is_correct: true,
        hints_used: 0,
        marking_method: "EXACT_NUMERIC",
        time_taken_ms: 4200,
        difficulty: 2,
      });
      expect(attempt!.answer).toBe("12");
      const mastery = await store.getMastery(users.learnerA, GOAL);
      expect(mastery!.record).toMatchObject({
        attempts: 1,
        correctAttempts: 1,
        masteryScore: record.masteryScore,
        difficulty: record.difficulty,
        currentState: record.currentState,
      });
      expect(mastery!.record.recentOutcomes).toEqual([true]);
      expect(mastery!.version).toBeTruthy();
      expect(await count("mastery_events", `learner_id = '${users.learnerA}'`)).toBe(1);
      const [ev] =
        await db.sql`select * from public.mastery_events where learner_id = ${users.learnerA}`;
      expect(ev).toMatchObject({
        question_id: qid,
        state_before: "NOT_STARTED",
        state_after: event.stateAfter,
        reason: event.reason,
      });
    });

    it("refuses a step made against an out-of-date session, and writes nothing", async () => {
      const s = await open(users.learnerB, "G4-OPS-ADDITION-WHOLE-NUMBERS-001");
      await store.commit(
        step(s, { messages: [{ role: "tutor", kind: "IDENTIFY", content: "first" }] }),
      );
      await expect(
        store.commit(
          step(s, {
            messages: [{ role: "tutor", kind: "INTRODUCE", content: "from a stale screen" }],
          }),
        ),
      ).rejects.toBeInstanceOf(StepConflictError);
      const messages = await store.listMessages(s.id);
      expect(messages.map((m) => m.content)).toEqual(["first"]);
      expect((await store.getSession(s.id))!.rev).toBe(1);
    });

    it("undoes the whole step when the mastery record was changed by someone else", async () => {
      const s = await open(users.learnerB, OTHER_GOAL);
      const qid = await questionFor(OTHER_GOAL, "rollback-1");
      const record = applyObservation(newMasteryRecord(new Date()), {
        outcome: "CORRECT",
        difficulty: 1,
        hintsUsed: 0,
        attemptNumber: 1,
        questionType: "NUMERIC",
        at: new Date(),
      }).record;
      // someone else created the record first
      await db.sql`insert into public.learner_objective_mastery (learner_id, objective_id)
                   values (${users.learnerB}, ${OTHER_GOAL})`;
      const attemptsBefore = await count("question_attempts");
      await expect(
        store.commit(
          step(s, {
            phase: "RESOLVED",
            messages: [{ role: "tutor", kind: "FEEDBACK", content: "must not be kept" }],
            attempt: attemptFor(qid, { objectiveId: OTHER_GOAL }),
            mastery: { objectiveId: OTHER_GOAL, expectedVersion: null, record },
          }),
        ),
      ).rejects.toBeInstanceOf(StepConflictError);
      expect(await count("question_attempts")).toBe(attemptsBefore);
      expect(await store.listMessages(s.id)).toHaveLength(0);
      expect(await store.getSession(s.id)).toMatchObject({ rev: 0, phase: "IDENTIFY_OBJECTIVE" });
    });

    it("updates mastery only against the version it was read at", async () => {
      const s = await open(users.learnerB, "G4-OPS-SUBTRACTION-WHOLE-NUMBERS-001");
      const goal = "G4-OPS-SUBTRACTION-WHOLE-NUMBERS-001";
      const first = applyObservation(newMasteryRecord(new Date()), {
        outcome: "INCORRECT",
        difficulty: 1,
        hintsUsed: 0,
        attemptNumber: 3,
        questionType: "NUMERIC",
        at: new Date(),
      }).record;
      let current = await store.commit(
        step(s, { mastery: { objectiveId: goal, expectedVersion: null, record: first } }),
      );
      const read = (await store.getMastery(users.learnerB, goal))!;
      const next = applyObservation(read.record, {
        outcome: "CORRECT",
        difficulty: 1,
        hintsUsed: 0,
        attemptNumber: 1,
        questionType: "NUMERIC",
        at: new Date(),
      }).record;
      // a stale version loses
      await expect(
        store.commit({
          ...step(s, {
            mastery: {
              objectiveId: goal,
              expectedVersion: "2020-01-01T00:00:00+00:00",
              record: next,
            },
          }),
          expectedRev: current,
        }),
      ).rejects.toBeInstanceOf(StepConflictError);
      // the version that was read wins
      current = await store.commit({
        ...step(s, { mastery: { objectiveId: goal, expectedVersion: read.version, record: next } }),
        expectedRev: current,
      });
      expect((await store.getMastery(users.learnerB, goal))!.record.attempts).toBe(2);
    });

    it("refuses an attempt for a question that belongs to another goal, and a repeated try", async () => {
      const s = await open(users.learnerB, "G4-OPS-MULTIPLICATION-WHOLE-NUMBERS-001");
      const goal = "G4-OPS-MULTIPLICATION-WHOLE-NUMBERS-001";
      const wrong = await questionFor(GOAL, "other-goal");
      await expectPgError(
        store.commit(step(s, { attempt: attemptFor(wrong, { objectiveId: goal }) })),
        "23514",
      );
      const mine = await questionFor(goal, "mine");
      const rev = await store.commit(step(s, { attempt: attemptFor(mine, { objectiveId: goal }) }));
      await expectPgError(
        store.commit({
          ...step(s, { attempt: attemptFor(mine, { objectiveId: goal }) }),
          expectedRev: rev,
        }),
        "23505",
      );
      // the failed step left the revision alone
      expect((await store.getSession(s.id))!.rev).toBe(rev);
    });

    it("refuses an unknown kind of message or a phase that does not exist", async () => {
      const s = await open(users.learnerB, "G4-NUM-PROPER-FRACTIONS-001");
      await expectPgError(
        store.commit(step(s, { messages: [{ role: "tutor", kind: "GOSSIP", content: "x" }] })),
        "23514",
      );
      await expectPgError(store.commit(step(s, { phase: "SOMEWHERE" as never })), "23514");
      expect((await store.getSession(s.id))!.rev).toBe(0);
    });

    it("marks when a session ended, and allows only one open session per goal", async () => {
      const s = await open(users.learnerB, "G4-NUM-PROPER-FRACTIONS-002");
      await expect(open(users.learnerB, "G4-NUM-PROPER-FRACTIONS-002")).rejects.toBeInstanceOf(
        ActiveSessionExistsError,
      );
      await store.commit(
        step(s, {
          phase: "ENDED",
          status: "COMPLETED",
          summary: {
            objectiveId: s.objectiveId,
            mode: "LEARN",
            questions: 2,
            firstTry: 1,
            hintsUsed: 1,
            minutes: 4.5,
            masteryStart: null,
            masteryEnd: { score: 0.3, state: "PRACTICING" },
            endedBy: "LEARNER",
          },
        }),
      );
      const [row] =
        await db.sql`select status, ended_at, summary from public.tutor_sessions where id = ${s.id}`;
      expect(row).toMatchObject({ status: "COMPLETED" });
      expect(row!.ended_at).not.toBeNull();
      expect(row!.summary).toMatchObject({ questions: 2, endedBy: "LEARNER" });
      // once it has ended, a new one may begin
      await expect(open(users.learnerB, "G4-NUM-PROPER-FRACTIONS-002")).resolves.toBeTruthy();
    });

    it("can be called by the server only", async () => {
      const s = await open(users.learnerB, "G4-NUM-PROPER-FRACTIONS-003");
      const call = (tx: typeof db.sql) =>
        tx`select public.tutor_commit(${s.id}::uuid, 0, 'LESSON', ${tx.json({})}::jsonb, 'ACTIVE', null, null, null, null)`;
      for (const actor of [users.learnerB, users.parentB, users.admin])
        await expectPgError(asUser(db.sql, { userId: actor }, (tx) => call(tx as never)));
      await expectPgError(asUser(db.sql, "anon", (tx) => call(tx as never)));
      await expect(asService(db.sql, (tx) => call(tx as never))).resolves.toBeTruthy();
    });

    it("says so when the session does not exist", async () => {
      await expectPgError(
        db.sql`select public.tutor_commit('00000000-0000-0000-0000-000000000000'::uuid, 0, 'LESSON', '{}'::jsonb, 'ACTIVE', null, null, null, null)`,
        "P0002",
      );
    });
  });

  describe("who can read what a child said", () => {
    it("lets the learner read their own conversation, and only an admin read what was flagged", async () => {
      const s = await open(users.learnerA, "G3-OPS-SUBTRACTION-WHOLE-NUMBERS-002");
      await store.commit(
        step(s, {
          messages: [
            { role: "tutor", kind: "IDENTIFY", content: "the goal" },
            { role: "learner", kind: "LEARNER_MESSAGE", content: "a private thought" },
            { role: "learner", kind: "LEARNER_MESSAGE", content: "flagged one", flagged: true },
          ],
        }),
      );
      const own = await asUser(
        db.sql,
        { userId: users.learnerA },
        (tx) =>
          tx`select content from public.tutor_messages where session_id = ${s.id} order by seq`,
      );
      expect(own.map((r) => r.content)).toEqual(["the goal", "a private thought", "flagged one"]);

      // the parent sees the session (counts), never the words
      const parentSessions = await asUser(
        db.sql,
        { userId: users.parentA },
        (tx) => tx`select id from public.tutor_sessions where id = ${s.id}`,
      );
      expect(parentSessions).toHaveLength(1);
      const parentMessages = await asUser(
        db.sql,
        { userId: users.parentA },
        (tx) => tx`select content from public.tutor_messages where session_id = ${s.id}`,
      );
      expect(parentMessages).toHaveLength(0);

      // another family sees nothing at all
      for (const table of ["tutor_sessions", "tutor_messages"]) {
        const rows = await asUser(db.sql, { userId: users.parentB }, (tx) =>
          tx.unsafe(
            `select 1 from public.${table} where ${table === "tutor_sessions" ? "id" : "session_id"} = '${s.id}'`,
          ),
        );
        expect(rows).toHaveLength(0);
      }
      const otherLearner = await asUser(
        db.sql,
        { userId: users.learnerB },
        (tx) => tx`select 1 from public.tutor_messages where session_id = ${s.id}`,
      );
      expect(otherLearner).toHaveLength(0);

      // an administrator reads only what the safety screen flagged
      const adminSees = await asUser(
        db.sql,
        { userId: users.admin },
        (tx) => tx`select content from public.tutor_messages where session_id = ${s.id}`,
      );
      expect(adminSees.map((r) => r.content)).toEqual(["flagged one"]);
    });

    it("lets nobody write a lesson from outside the server", async () => {
      const s = await open(users.learnerA, "G3-OPS-ADDITION-WHOLE-NUMBERS-003");
      for (const actor of [users.learnerA, users.parentA, users.admin]) {
        await expectPgError(
          asUser(
            db.sql,
            { userId: actor },
            (tx) =>
              tx`insert into public.tutor_messages (session_id, learner_id, role, kind, content)
                 values (${s.id}, ${users.learnerA}, 'learner', 'LEARNER_MESSAGE', 'forged')`,
          ),
        );
        await expectPgError(
          asUser(
            db.sql,
            { userId: actor },
            (tx) => tx`update public.tutor_sessions set status = 'COMPLETED' where id = ${s.id}`,
          ),
        );
        await expectPgError(
          asUser(
            db.sql,
            { userId: actor },
            (tx) => tx`delete from public.tutor_messages where session_id = ${s.id}`,
          ),
        );
      }
    });
  });

  describe("a whole lesson through the service, on the real tables", () => {
    const deps = (): TutorDeps => ({
      store,
      bank,
      curriculum: new FixtureCurriculum(),
      voice: createVoice(),
    });

    it("runs from the first card to the end and leaves a consistent record", async () => {
      const d = deps();
      let view = await startOrResume(d, {
        learnerId: users.learnerA,
        objectiveId: FLOW_GOAL,
      });
      expect(view.status).toBe("ACTIVE");
      const sessionId = view.sessionId;
      const doAct = (action: Parameters<typeof act>[1]["action"]) =>
        act(d, { learnerId: users.learnerA, sessionId, action });

      view = await doAct({ type: "SKIP_LESSON" });
      if (view.phase !== "AWAITING_ANSWER") view = await doAct({ type: "CONTINUE" });
      let guard = 0;
      while (view.status === "ACTIVE" && guard++ < 40) {
        if (view.actions.includes("ANSWER")) {
          const id = view.openQuestion!.id;
          const right = guard % 3 !== 0;
          view = await doAct({
            type: "ANSWER",
            questionId: id,
            answer: right ? await rightAnswer(bank, id) : await wrongAnswer(bank, id),
          });
        } else if (view.actions.includes("NEXT_QUESTION"))
          view = await doAct({ type: "NEXT_QUESTION" });
        else if (view.actions.includes("CONTINUE")) view = await doAct({ type: "CONTINUE" });
        else break;
      }
      expect(view.status).toBe("COMPLETED");

      const [session] = await db.sql`select * from public.tutor_sessions where id = ${sessionId}`;
      const summary = session!.summary as { questions: number; firstTry: number };
      expect(summary.questions).toBeGreaterThan(0);
      expect(session!.phase).toBe("ENDED");
      expect(session!.rev).toBeGreaterThan(5);
      expect(
        await count(
          "mastery_events",
          `learner_id = '${users.learnerA}' and objective_id = '${FLOW_GOAL}'`,
        ),
      ).toBe(summary.questions);
      const mastery = await store.getMastery(users.learnerA, FLOW_GOAL);
      expect(mastery!.record.attempts).toBe(summary.questions);
      // each tried question has attempts numbered 1, 2, 3 … without gaps
      const attempts = await db.sql<Array<{ question_id: string; n: number[] }>>`
        select question_id, array_agg(attempt_number order by attempt_number) as n
        from public.question_attempts where session_id = ${sessionId} group by question_id`;
      for (const row of attempts) expect(row.n).toEqual(row.n.map((_, i) => i + 1));
      // the messages are in the order they were said
      const seqs = (await store.listMessages(sessionId)).map((m) => m.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      // and nothing a child typed is in the state or the summary
      const strings: string[] = [];
      JSON.stringify(session!.state, (_key, value) => {
        if (typeof value === "string") strings.push(value);
        return value;
      });
      for (const value of strings)
        expect(value).toMatch(/^(?:[0-9a-f-]{36}|\d{4}-\d\d-\d\dT[\d:.]+Z|[A-Z0-9_-]+)$/);
    }, 60_000);

    it("applies two simultaneous answers once, even against the real transaction", async () => {
      const d = deps();
      let view = await startOrResume(d, {
        learnerId: users.learnerB,
        objectiveId: "G4-OPS-MULTIPLICATION-WHOLE-NUMBERS-002",
        mode: "PRACTISE",
      });
      const sessionId = view.sessionId;
      const id = view.openQuestion!.id;
      const answer = await rightAnswer(bank, id);
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          act(d, {
            learnerId: users.learnerB,
            sessionId,
            action: { type: "ANSWER", questionId: id, answer },
          }),
        ),
      );
      expect(results.every((v) => v.phase === "RESOLVED")).toBe(true);
      expect(await count("question_attempts", `session_id = '${sessionId}'`)).toBe(1);
      expect(
        await count("mastery_events", `learner_id = '${users.learnerB}' and question_id = '${id}'`),
      ).toBe(1);
      view = await act(d, { learnerId: users.learnerB, sessionId, action: { type: "END" } });
      expect(view.status).toBe("COMPLETED");
    });

    it("shows an administrator a flagged message, and only that", async () => {
      const d = deps();
      const view = await startOrResume(d, {
        learnerId: users.learnerB,
        objectiveId: "G4-NUM-PROPER-FRACTIONS-004",
        mode: "PRACTISE",
      });
      await act(d, {
        learnerId: users.learnerB,
        sessionId: view.sessionId,
        action: { type: "ASK", text: "call me on 0771234567" },
      });
      await act(d, {
        learnerId: users.learnerB,
        sessionId: view.sessionId,
        action: { type: "ASK", text: "why is a half bigger than a third?" },
      });
      const seen = await asUser(
        db.sql,
        { userId: users.admin },
        (tx) =>
          tx`select content, flagged from public.tutor_messages where session_id = ${view.sessionId}`,
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]!.flagged).toBe(true);
      expect(seen[0]!.content).toContain("[removed]");
      expect(seen[0]!.content).not.toContain("0771234567");
      // the child still sees the whole conversation
      const own = await asUser(
        db.sql,
        { userId: users.learnerB },
        (tx) =>
          tx`select kind from public.tutor_messages where session_id = ${view.sessionId} order by seq`,
      );
      expect(own.map((r) => r.kind)).toEqual([
        "IDENTIFY",
        "QUESTION",
        "LEARNER_MESSAGE",
        "SAFETY",
        "LEARNER_MESSAGE",
        "ANSWER",
      ]);
    });
  });
});
