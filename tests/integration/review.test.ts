import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { learnerEmail } from "../../src/lib/auth/credentials";
import { provisionLearner } from "../../src/lib/auth/learners";
import { createSupabaseProvisioningPorts } from "../../src/lib/auth/learners.server";
import { SupabaseBankStore } from "../../src/lib/questions/bank";
import {
  countUnverified,
  decideQuestion,
  listQuestions,
  readKeys,
} from "../../src/lib/questions/review";
import { listFlagged, countOpenFlagged, reviewFlagged } from "../../src/lib/safety/review";
import { act, startOrResume, type TutorDeps } from "../../src/lib/tutor/service";
import { SupabaseCurriculumPort } from "../../src/lib/tutor/supabase-curriculum";
import { SupabaseTutorStore } from "../../src/lib/tutor/supabase-store";
import { createVoice } from "../../src/lib/tutor/voice";

/**
 * What an administrator can see and decide, through the real API: the messages the safety screen
 * flagged (and no others), reviews that are audited without the child's words, and the decisions
 * about practice questions.
 */

const URL = process.env.INTEGRATION_SUPABASE_URL;
const ANON = process.env.INTEGRATION_SUPABASE_ANON_KEY;
const SERVICE = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL && ANON && SERVICE);
const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const PASSWORD = "correct horse battery staple";
const run = Date.now().toString(36);
const GOAL = "G5-OPS-ADDITION-WHOLE-NUMBERS-001";

describe.skipIf(!configured)("administrator review (real API)", () => {
  let service: SupabaseClient;
  let admin: { id: string; db: SupabaseClient };
  let parent: { id: string; db: SupabaseClient };
  let learnerId = "";
  let flaggedId = "";
  let questionId = "";

  async function signUp(label: string) {
    const db = createClient(URL!, ANON!, options);
    const { data, error } = await db.auth.signUp({
      email: `${label}-${run}@example.test`,
      password: PASSWORD,
    });
    if (error || !data.user) throw error ?? new Error("sign-up failed");
    return { id: data.user.id, db };
  }

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
    service = createClient(URL!, SERVICE!, options);
    admin = await signUp("review-admin");
    const promoted = await service.from("profiles").update({ role: "admin" }).eq("id", admin.id);
    if (promoted.error) throw promoted.error;
    parent = await signUp("review-parent");
    const username = `rev${run}`;
    const made = await provisionLearner(createSupabaseProvisioningPorts(), parent.id, {
      displayName: "Rudo",
      username,
      password: PASSWORD,
      grade: 5,
    });
    if (!made.ok) throw new Error(made.error);
    const learnerDb = createClient(URL!, ANON!, options);
    const { data } = await learnerDb.auth.signInWithPassword({
      email: learnerEmail(username),
      password: PASSWORD,
    });
    learnerId = data.user!.id;

    // a lesson in which the child writes something ordinary and something with a phone number in it
    const deps: TutorDeps = {
      store: new SupabaseTutorStore(service),
      bank: new SupabaseBankStore(service),
      curriculum: new SupabaseCurriculumPort(service),
      voice: createVoice(),
    };
    const view = await startOrResume(deps, { learnerId, objectiveId: GOAL });
    await act(deps, { learnerId, sessionId: view.sessionId, action: { type: "CONTINUE" } });
    await act(deps, { learnerId, sessionId: view.sessionId, action: { type: "CONTINUE" } });
    await act(deps, {
      learnerId,
      sessionId: view.sessionId,
      action: { type: "ASK", text: "why do we carry the one?" },
    });
    await act(deps, {
      learnerId,
      sessionId: view.sessionId,
      action: { type: "ASK", text: "my number is 0771234567" },
    });
    const { data: messages } = await service
      .from("tutor_messages")
      .select("id, flagged")
      .eq("learner_id", learnerId)
      .eq("kind", "LEARNER_MESSAGE");
    flaggedId = messages!.find((m) => m.flagged)!.id as string;

    const { data: questions } = await service
      .from("questions")
      .select("id")
      .eq("learning_objective_id", GOAL)
      .eq("verification_status", "UNVERIFIED")
      .eq("status", "ACTIVE")
      .limit(1);
    questionId = questions![0]!.id as string;
  }, 90_000);

  describe("flagged messages", () => {
    it("shows an administrator the flagged message, stripped of the number, and nothing else said", async () => {
      const items = await listFlagged(admin.db);
      const mine = items.filter((i) => i.learnerId === learnerId);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        messageId: flaggedId,
        learnerName: "Rudo",
        grade: 5,
        categories: ["PERSONAL_INFO"],
        review: null,
      });
      expect(mine[0]!.content).toContain("[removed]");
      expect(JSON.stringify(items)).not.toContain("0771234567");
      expect(JSON.stringify(mine)).not.toContain("carry the one");
      expect((await countOpenFlagged(admin.db)).open).toBeGreaterThanOrEqual(1);
    });

    it("shows a parent nothing", async () => {
      expect(await listFlagged(parent.db)).toEqual([]);
    });

    it("records a decision, audits it without the child's words, and lets it be changed", async () => {
      const first = await reviewFlagged(service, admin.id, {
        messageId: flaggedId,
        outcome: "NO_CONCERN",
        note: "a phone number; removed",
      });
      expect(first).toEqual({ ok: true });
      let item = (await listFlagged(admin.db)).find((i) => i.messageId === flaggedId)!;
      expect(item.review).toMatchObject({ outcome: "NO_CONCERN", note: "a phone number; removed" });

      const second = await reviewFlagged(service, admin.id, {
        messageId: flaggedId,
        outcome: "ACTION_TAKEN",
      });
      expect(second).toEqual({ ok: true });
      item = (await listFlagged(admin.db)).find((i) => i.messageId === flaggedId)!;
      expect(item.review).toMatchObject({ outcome: "ACTION_TAKEN", note: null });

      const { data: audit } = await service
        .from("admin_audit_log")
        .select("action, admin_id, before_state, after_state")
        .eq("entity_type", "tutor_message")
        .eq("entity_id", flaggedId)
        .order("id");
      expect(audit!.map((a) => a.action)).toEqual(["SAFETY_REVIEWED", "SAFETY_RE_REVIEWED"]);
      expect(audit![0]).toMatchObject({ admin_id: admin.id, before_state: null });
      expect(audit![1]!.before_state).toMatchObject({ outcome: "NO_CONCERN" });
      // the log holds the decision and the administrator's note, never the child's message
      expect(JSON.stringify(audit)).not.toMatch(/0771234567|carry the one|my number is/);
      for (const entry of audit!)
        for (const state of [entry.before_state, entry.after_state])
          if (state) expect(Object.keys(state).sort()).toEqual(["note", "outcome"]);
    });

    it("refuses to review a message the screen did not flag", async () => {
      const { data } = await service
        .from("tutor_messages")
        .select("id")
        .eq("learner_id", learnerId)
        .eq("flagged", false)
        .limit(1);
      const result = await reviewFlagged(service, admin.id, {
        messageId: data![0]!.id as string,
        outcome: "NO_CONCERN",
      });
      expect(result).toMatchObject({ ok: false });
    });
  });

  describe("practice questions", () => {
    it("lists questions for an administrator, with filters and pages, and for nobody else", async () => {
      const page = await listQuestions(admin.db, {
        page: 1,
        verification: "UNVERIFIED",
        objective: GOAL.slice(0, 6),
      });
      expect(page.total).toBeGreaterThan(0);
      expect(page.rows.length).toBeLessThanOrEqual(15);
      expect(page.rows[0]!.question.label.text).toMatch(/not part of the syllabus/);
      expect(page.rows[0]!.objectiveText).toMatch(/\w/);
      const none = await listQuestions(admin.db, { page: 1, template: "no-such-template" });
      expect(none.rows).toEqual([]);
      // a parent's session sees no questions at all
      const asParent = await listQuestions(parent.db, { page: 1 });
      expect(asParent.rows).toEqual([]);
      expect(await countUnverified(admin.db)).toBeGreaterThan(0);
    });

    it("shows the right answer, hints and explanation to the reviewer through the server's key", async () => {
      const page = await listQuestions(admin.db, { page: 1, objective: GOAL });
      const keys = await readKeys(service, page.rows);
      expect(keys.size).toBe(page.rows.length);
      for (const key of keys.values()) {
        expect(key.answer).toMatch(/\S/);
        expect(key.explanation).toMatch(/\S/);
      }
      // ... which a parent's or an administrator's own session can never read
      const direct = await admin.db.from("question_keys").select("question_id").limit(1);
      expect(direct.error?.code).toBe("42501");
    });

    it("approves, rejects and reopens, auditing each change", async () => {
      const approve = await decideQuestion(service, admin.id, { questionId, action: "APPROVE" });
      expect(approve).toEqual({ ok: true, changed: true });
      let row = await service
        .from("questions")
        .select("verification_status, status")
        .eq("id", questionId)
        .single();
      expect(row.data).toEqual({ verification_status: "ADMIN_REVIEWED", status: "ACTIVE" });
      const again = await decideQuestion(service, admin.id, { questionId, action: "APPROVE" });
      expect(again).toEqual({ ok: true, changed: false });

      const reject = await decideQuestion(service, admin.id, { questionId, action: "REJECT" });
      expect(reject).toEqual({ ok: true, changed: true });
      row = await service
        .from("questions")
        .select("verification_status, status")
        .eq("id", questionId)
        .single();
      expect(row.data).toEqual({ verification_status: "REJECTED", status: "RETIRED" });

      const reopen = await decideQuestion(service, admin.id, { questionId, action: "REOPEN" });
      expect(reopen).toEqual({ ok: true, changed: true });
      row = await service
        .from("questions")
        .select("verification_status, status")
        .eq("id", questionId)
        .single();
      expect(row.data).toEqual({ verification_status: "UNVERIFIED", status: "ACTIVE" });

      const { data: audit } = await service
        .from("admin_audit_log")
        .select("action, before_state, after_state")
        .eq("entity_type", "question")
        .eq("entity_id", questionId)
        // only this run's administrator: the same question may have been reviewed by earlier runs of
        // this suite, or by the browser tests, against the same database
        .eq("admin_id", admin.id)
        .order("id");
      expect(audit!.map((a) => a.action)).toEqual([
        "QUESTION_APPROVED",
        "QUESTION_REJECTED",
        "QUESTION_REOPENED",
      ]);
      expect(audit![1]).toMatchObject({
        before_state: { verification: "ADMIN_REVIEWED", status: "ACTIVE" },
        after_state: { verification: "REJECTED", status: "RETIRED" },
      });
    });

    it("tells a child that an approved question was checked by a teacher", async () => {
      await decideQuestion(service, admin.id, { questionId, action: "APPROVE" });
      const page = await listQuestions(admin.db, {
        page: 1,
        verification: "ADMIN_REVIEWED",
        objective: GOAL,
      });
      const approved = page.rows.find((r) => r.question.id === questionId)!;
      expect(approved.question.label.text).toBe(
        "ZimTutor practice question (checked by a teacher)",
      );
      expect(approved.question.label.official).toBe(false);
      await decideQuestion(service, admin.id, { questionId, action: "REOPEN" });
    });

    it("refuses a question that does not exist", async () => {
      const result = await decideQuestion(service, admin.id, {
        questionId: "00000000-0000-4000-8000-0000000000ff",
        action: "APPROVE",
      });
      expect(result).toMatchObject({ ok: false });
    });
  });
});
