import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { learnerEmail } from "../../src/lib/auth/credentials";
import { provisionLearner } from "../../src/lib/auth/learners";
import { createSupabaseProvisioningPorts } from "../../src/lib/auth/learners.server";
import {
  ExamError,
  finishPaper,
  findOpenPaper,
  getPaperView,
  listPapers,
  saveAnswer,
  startPaper,
  type ExamDeps,
} from "../../src/lib/exam/service";
import type { LearnerAnswer } from "../../src/lib/marking/spec";
import { SupabaseBankStore, getQuestionKey } from "../../src/lib/questions/bank";

/**
 * Practice papers through the real API: choosing and keeping the questions, saving answers as the child
 * goes, marking once, and what the mark does to the learner's record (and who may see it).
 */

const URL = process.env.INTEGRATION_SUPABASE_URL;
const ANON = process.env.INTEGRATION_SUPABASE_ANON_KEY;
const SERVICE = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL && ANON && SERVICE);
const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const PASSWORD = "correct horse battery staple";
const run = Date.now().toString(36);

describe.skipIf(!configured)("practice papers (real API)", () => {
  let service: SupabaseClient;
  let parent: { id: string; db: SupabaseClient };
  let stranger: { id: string; db: SupabaseClient };
  let learner: { id: string; db: SupabaseClient };
  let deps: ExamDeps;
  let bank: SupabaseBankStore;

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
    parent = await signUp("exam-parent");
    stranger = await signUp("exam-stranger");
    const username = `ex${run}`;
    const made = await provisionLearner(createSupabaseProvisioningPorts(), parent.id, {
      displayName: "Farai",
      username,
      password: PASSWORD,
      grade: 7,
    });
    if (!made.ok) throw new Error(made.error);
    const db = createClient(URL!, ANON!, options);
    const { data } = await db.auth.signInWithPassword({
      email: learnerEmail(username),
      password: PASSWORD,
    });
    learner = { id: data.user!.id, db };
    bank = new SupabaseBankStore(service);
    deps = { service, bank };
  }, 60_000);

  /** The right answer to every part of a paper, by position. */
  async function rightAnswers(setId: string): Promise<Map<number, LearnerAnswer>> {
    const { data } = await service
      .from("assessment_set_items")
      .select("position, question_id")
      .eq("set_id", setId);
    const out = new Map<number, LearnerAnswer>();
    for (const row of data!) {
      const key = await getQuestionKey(bank, row.question_id as string);
      out.set(row.position as number, key!.display);
    }
    return out;
  }

  let paperId = "";

  describe("a short multiple-choice paper", () => {
    it("is chosen once, kept with its plan, and shows nothing about the answers while it is open", async () => {
      paperId = await startPaper(deps, {
        learnerId: learner.id,
        paperNumber: 1,
        length: "SHORT",
        seed: "it-1",
      });
      expect(await findOpenPaper(deps, learner.id)).toBe(paperId);
      const view = await getPaperView(deps, { setId: paperId, learnerId: learner.id });
      expect(view).toMatchObject({
        status: "IN_PROGRESS",
        grade: 7,
        kind: "EXAM_STYLE_PAPER_1",
        length: "SHORT",
        total: 20,
        answered: 0,
        recommendedMinutes: 60,
        marksAvailable: 20,
        result: null,
      });
      expect(view.title).toMatch(/Paper 1/);
      expect(view.citation).toMatch(/Junior Mathematics Syllabus.*page/);
      expect(view.shares.target).toEqual(view.shares.official);
      expect(view.shares.achieved).toEqual({
        KNOWLEDGE_COMPREHENSION: 50,
        APPLICATION_ANALYSIS: 40,
        PROBLEM_SOLVING: 10,
      });
      const parts = view.sections.flatMap((s) => s.questions.flatMap((q) => q.parts));
      expect(parts).toHaveLength(20);
      for (const part of parts) {
        expect(part.review).toBeNull();
        expect(part.saved).toBeNull();
        // every part of a multiple-choice paper is a choice, with at least three options
        expect(part.question.answerKind).toBe("CHOICE");
        expect(part.question.options!.length).toBeGreaterThanOrEqual(3);
      }
      // nothing in what the browser is given tells the answer
      const text = JSON.stringify(view);
      expect(text).not.toMatch(/explanation|distractor|correctAnswer|expected_answer|"hints"/);
      // the paper is never presented as official
      const { data } = await service
        .from("assessment_sets")
        .select("is_official_zimsec")
        .eq("id", paperId)
        .single();
      expect(data!.is_official_zimsec).toBe(false);
    });

    it("lets a learner have one paper open at a time", async () => {
      await expect(
        startPaper(deps, { learnerId: learner.id, paperNumber: 2, length: "SHORT", seed: "it-2" }),
      ).rejects.toMatchObject({ code: "ACTIVE_PAPER" });
    });

    it("keeps answers as the child goes, and only for their own paper", async () => {
      const right = await rightAnswers(paperId);
      for (const position of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
        await saveAnswer(deps, {
          setId: paperId,
          learnerId: learner.id,
          position,
          answer: right.get(position)!,
        });
      // changing an answer replaces it
      await saveAnswer(deps, { setId: paperId, learnerId: learner.id, position: 13, answer: "A" });
      await saveAnswer(deps, { setId: paperId, learnerId: learner.id, position: 13, answer: "B" });
      // three wrong answers (an option that is not the right one)
      for (const position of [14, 15, 16]) {
        const key = right.get(position) as string;
        await saveAnswer(deps, {
          setId: paperId,
          learnerId: learner.id,
          position,
          answer: key === "A" ? "B" : "A",
        });
      }
      const view = await getPaperView(deps, { setId: paperId, learnerId: learner.id });
      expect(view.answered).toBe(16);
      const saved = view.sections
        .flatMap((s) => s.questions.flatMap((q) => q.parts))
        .find((p) => p.position === 13);
      expect(saved?.saved).toBe("B");

      await expect(
        saveAnswer(deps, { setId: paperId, learnerId: stranger.id, position: 17, answer: "A" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        saveAnswer(deps, { setId: paperId, learnerId: learner.id, position: 99, answer: "A" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        saveAnswer(deps, {
          setId: paperId,
          learnerId: learner.id,
          position: 17,
          answer: "x".repeat(2500),
        }),
      ).rejects.toMatchObject({ code: "INVALID" });
      await expect(
        getPaperView(deps, { setId: paperId, learnerId: stranger.id }),
      ).rejects.toBeInstanceOf(ExamError);
    });

    it("is marked once: marks, shares, what to revisit, and the child's record all follow", async () => {
      const view = await finishPaper(deps, { setId: paperId, learnerId: learner.id });
      expect(view.status).toBe("COMPLETED");
      expect(view.result).toMatchObject({ marksAvailable: 20, unanswered: 4 });
      // twelve right, the wrong ones may include a lucky guess on the answer they changed to
      expect(view.result!.marksAwarded).toBeGreaterThanOrEqual(12);
      expect(view.result!.marksAwarded).toBeLessThanOrEqual(14);
      expect(view.result!.bands).toHaveLength(3);
      expect(view.result!.revisit.length).toBeGreaterThan(0);
      expect(view.result!.revisit[0]!.text).toMatch(/\w/);

      // now the answers are shown, with the reasons
      const parts = view.sections.flatMap((s) => s.questions.flatMap((q) => q.parts));
      for (const part of parts) {
        expect(part.review).not.toBeNull();
        expect(part.review!.rightAnswer).toMatch(/\S/);
        expect(part.review!.explanation).toMatch(/\S/);
      }
      expect(parts.find((p) => p.position === 20)!.review!.yourAnswer).toBeNull();
      expect(parts.find((p) => p.position === 1)!.review!.awarded).toBe(1);

      // the answers became evidence: one attempt per answered question, and mastery moved
      const { count } = await service
        .from("question_attempts")
        .select("id", { count: "exact", head: true })
        .eq("learner_id", learner.id)
        .is("session_id", null);
      expect(count).toBe(16);
      const { data: mastery } = await service
        .from("learner_objective_mastery")
        .select("objective_id, attempts")
        .eq("learner_id", learner.id);
      expect(mastery!.length).toBeGreaterThanOrEqual(8);
      const { data: set } = await service
        .from("assessment_sets")
        .select("status, marks_awarded, marks_available, is_official_zimsec, completed_at")
        .eq("id", paperId)
        .single();
      expect(set).toMatchObject({
        status: "COMPLETED",
        marks_available: 20,
        is_official_zimsec: false,
      });
      expect(set!.completed_at).not.toBeNull();
    });

    it("cannot be marked again, changed afterwards, or leave two copies of the evidence", async () => {
      const again = await finishPaper(deps, { setId: paperId, learnerId: learner.id });
      expect(again.status).toBe("COMPLETED");
      const { count } = await service
        .from("question_attempts")
        .select("id", { count: "exact", head: true })
        .eq("learner_id", learner.id)
        .is("session_id", null);
      expect(count).toBe(16);
      await expect(
        saveAnswer(deps, { setId: paperId, learnerId: learner.id, position: 20, answer: "A" }),
      ).rejects.toMatchObject({ code: "FINISHED" });
      // two clicks at once mark it once
      const second = await startPaper(deps, {
        learnerId: learner.id,
        paperNumber: 1,
        length: "SHORT",
        seed: "it-3",
      });
      await Promise.all([
        finishPaper(deps, { setId: second, learnerId: learner.id }),
        finishPaper(deps, { setId: second, learnerId: learner.id }),
      ]);
      const { count: after } = await service
        .from("question_attempts")
        .select("id", { count: "exact", head: true })
        .eq("learner_id", learner.id)
        .is("session_id", null);
      expect(after).toBe(16); // the second paper had no answers: nothing to record, and nothing twice
    });
  });

  describe("a short structured paper", () => {
    it("has parts for every mark, and counts the best two answered of the three in section B", async () => {
      const id = await startPaper(deps, {
        learnerId: learner.id,
        paperNumber: 2,
        length: "SHORT",
        seed: "it-4",
      });
      const view = await getPaperView(deps, { setId: id, learnerId: learner.id });
      expect(view.kind).toBe("EXAM_STYLE_PAPER_2");
      const [a, b] = view.sections;
      expect(a!.questions).toHaveLength(5);
      expect(a!.questions.reduce((n, q) => n + q.marks, 0)).toBe(13);
      expect(b!.questions).toHaveLength(3);
      expect(b!.questions.every((q) => q.marks === 5 && q.parts.length === 5)).toBe(true);
      expect(view.marksAvailable).toBe(23);

      const right = await rightAnswers(id);
      // section A all right; section B: questions 1 and 2 right, question 3 left alone
      for (const q of a!.questions)
        for (const part of q.parts)
          await saveAnswer(deps, {
            setId: id,
            learnerId: learner.id,
            position: part.position,
            answer: right.get(part.position)!,
          });
      for (const q of b!.questions.slice(0, 2))
        for (const part of q.parts)
          await saveAnswer(deps, {
            setId: id,
            learnerId: learner.id,
            position: part.position,
            answer: right.get(part.position)!,
          });
      const done = await finishPaper(deps, { setId: id, learnerId: learner.id });
      expect(done.result).toMatchObject({ marksAvailable: 23, unanswered: 0 });
      expect(done.result!.marksAwarded).toBeGreaterThanOrEqual(22);
      const counted = done.sections.flatMap((s) => s.questions).filter((q) => q.counted);
      expect(counted.filter((q) => q.section === "B").map((q) => q.number)).toEqual([1, 2]);
    });
  });

  describe("who can see a paper", () => {
    it("shows it to the learner and to their parent, with the practice mark, and to nobody else", async () => {
      const own = await listPapers(learner.db, learner.id);
      expect(own.length).toBeGreaterThanOrEqual(3);
      const first = own.find((p) => p.id === paperId)!;
      expect(first).toMatchObject({
        kind: "EXAM_STYLE_PAPER_1",
        status: "COMPLETED",
        marksAvailable: 20,
      });
      expect(first.percent).toBeGreaterThanOrEqual(60);
      expect(first.bands).toHaveLength(3);
      const asParent = await listPapers(parent.db, learner.id);
      expect(asParent.map((p) => p.id).sort()).toEqual(own.map((p) => p.id).sort());
      expect(await listPapers(stranger.db, learner.id)).toEqual([]);
    });

    it("cannot be written by the learner's own session", async () => {
      const forged = await learner.db
        .from("assessment_sets")
        .update({ marks_awarded: 20, status: "COMPLETED" })
        .eq("id", paperId);
      expect(forged.data ?? []).toEqual([]);
      const { data } = await service
        .from("assessment_sets")
        .select("marks_awarded")
        .eq("id", paperId)
        .single();
      expect(Number(data!.marks_awarded)).toBeLessThan(20);
      const items = await learner.db
        .from("assessment_set_items")
        .update({ awarded: 1 })
        .eq("set_id", paperId);
      expect(items.data ?? []).toEqual([]);
      const start = await learner.db.rpc("exam_start", {
        p_learner: learner.id,
        p_set: {},
        p_items: [],
      });
      expect(start.error).not.toBeNull();
    });
  });
});
