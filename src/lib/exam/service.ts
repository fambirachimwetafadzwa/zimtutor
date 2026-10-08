import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { cachedPath } from "../adaptive/cache";
import { getLearnerGrade } from "../adaptive/service";
import { practicableObjectiveIds, toObjectiveInfo } from "../adaptive/practice";
import type { LearnerAnswer } from "../marking/spec";
import { recordObservation } from "../mastery/service";
import { getMisconception } from "../misconceptions/registry";
import { checkAnswer } from "../questions/answer";
import {
  toQuestionKey,
  KEY_COLUMNS,
  QUESTION_COLUMNS,
  storedKeySchema,
  storedQuestionSchema,
  toPublicQuestion,
  type PublicQuestion,
  type QuestionKey,
} from "../questions/bank-rows";
import type { BankStore } from "../questions/bank";
import { Rng } from "../questions/rng";
import { ALL_TEMPLATES } from "../questions/templates";
import type { QuestionTemplate } from "../questions/types";
import {
  answerAsText,
  answerForStorage,
  answerIsReasonable,
  describeLearnerAnswer,
} from "../tutor/answers";
import { NotEnoughQuestions, assemble, type Shortfall } from "./assemble";
import { buildPlan, type PaperKind, type PaperLength, type PaperPlan } from "./plan";
import { buildPool } from "./pool";
import { summarise, type PaperResult, type ResultItem } from "./results";
import { BANDS, BAND_LABELS, loadStructure, type Proportions, type SkillBand } from "./structure";
import { BAND_OF } from "./assemble";

/**
 * Practice papers, from choosing the questions to marking them.
 *
 * All writes use the SERVICE-ROLE client and are only reached after the server has authenticated the
 * learner (a child cannot choose their own questions or marks). Answers are saved as the child goes;
 * marking happens once, when the paper is finished, by the deterministic marking engine (never a
 * language model), and what the child answered then feeds the same mastery record as a lesson does.
 *
 * Every mark is a ZIMTUTOR PRACTICE SCORE, never a ZIMSEC result.
 */

export type ExamErrorCode =
  "ACTIVE_PAPER" | "NOT_FOUND" | "FORBIDDEN" | "FINISHED" | "NOT_ENOUGH" | "INVALID";

export class ExamError extends Error {
  constructor(
    readonly code: ExamErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExamError";
  }
}

export interface ExamDeps {
  /** Service-role client. */
  service: SupabaseClient;
  bank: BankStore;
  templates?: readonly QuestionTemplate[];
  now?: () => Date;
  /** Told about what happens (never anything a child wrote). */
  onEvent?: (event: ExamEvent) => void;
}

export type ExamEvent =
  | {
      type: "paper_started";
      kind: PaperKind;
      length: PaperLength;
      items: number;
      shortfalls: number;
    }
  | { type: "paper_finished"; percent: number; marks: number; of: number }
  /** The paper was marked but its answers could not all be added to the learner's mastery record. */
  | { type: "paper_evidence_failed" };

const clock = (deps: ExamDeps): Date => (deps.now ? deps.now() : new Date());

// ── views ───────────────────────────────────────────────────────────────────────────────────────

export interface PartReview {
  /** Share of the marks earned, 0 to 1. */
  awarded: number;
  yourAnswer: string | null;
  rightAnswer: string;
  explanation: string;
}

export interface PartView {
  position: number;
  part: number;
  marks: number;
  question: PublicQuestion;
  saved: LearnerAnswer | null;
  /** Only once the paper is marked. */
  review: PartReview | null;
}

export interface QuestionView {
  section: string;
  number: number;
  marks: number;
  parts: PartView[];
  /** Counted towards the mark (always true unless the child chose other questions in a section with a choice). */
  counted: boolean | null;
}

export interface ResultView {
  marksAwarded: number;
  marksAvailable: number;
  percent: number;
  bands: Array<{
    band: SkillBand;
    label: string;
    awarded: number;
    available: number;
    percent: number;
  }>;
  topics: Array<{ topicCode: string; awarded: number; available: number; percent: number }>;
  unanswered: number;
  revisit: Array<{ objectiveId: string; text: string; lost: number }>;
  misconceptions: Array<{ tag: string; name: string; count: number }>;
}

export interface PaperView {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  grade: number;
  kind: PaperKind;
  paperNumber: 1 | 2;
  length: PaperLength;
  title: string;
  startedAt: string;
  completedAt: string | null;
  recommendedMinutes: number | null;
  marksAvailable: number;
  sections: Array<{
    id: string;
    label: string;
    offered: number;
    counted: number;
    questions: QuestionView[];
  }>;
  shares: {
    target: Proportions;
    official: Proportions;
    achieved: Proportions;
    shortfalls: Shortfall[];
  };
  citation: string;
  answered: number;
  total: number;
  result: ResultView | null;
}

// ── what is stored ──────────────────────────────────────────────────────────────────────────────

const storedPlan = z.object({
  plan: z.custom<PaperPlan>((value) => typeof value === "object" && value !== null),
  achieved: z.record(z.string(), z.number()),
  shortfalls: z.array(z.object({ band: z.enum(BANDS), wanted: z.number(), got: z.number() })),
});

const setRow = z.object({
  id: z.string(),
  learner_id: z.string(),
  kind: z.enum(["FORMATIVE", "EXAM_STYLE_PAPER_1", "EXAM_STYLE_PAPER_2"]),
  grade: z.number().int(),
  paper_number: z.number().int().nullable(),
  paper_length: z.enum(["FULL", "SHORT"]),
  status: z.enum(["IN_PROGRESS", "COMPLETED"]),
  plan: z.unknown(),
  recommended_minutes: z.number().int().nullable(),
  marks_available: z.number().int().nullable(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  result: z.unknown(),
});
type SetRow = z.infer<typeof setRow>;

const itemRow = z.object({
  set_id: z.string(),
  position: z.number().int(),
  question_id: z.string(),
  marks: z.number().int(),
  skill: z.string(),
  section: z.string(),
  question_number: z.number().int(),
  part: z.number().int(),
  answer: z.unknown(),
  awarded: z.coerce.number().nullable(),
  tags: z.array(z.string()),
});
type ItemRow = z.infer<typeof itemRow>;

const SET_COLUMNS =
  "id, learner_id, kind, grade, paper_number, paper_length, status, plan, recommended_minutes, marks_available, started_at, completed_at, result";
const ITEM_COLUMNS =
  "set_id, position, question_id, marks, skill, section, question_number, part, answer, awarded, tags";

async function readSet(deps: ExamDeps, setId: string): Promise<SetRow> {
  const { data, error } = await deps.service
    .from("assessment_sets")
    .select(SET_COLUMNS)
    .eq("id", setId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the paper: ${error.message}`);
  if (!data) throw new ExamError("NOT_FOUND", "That paper does not exist.");
  return setRow.parse(data);
}

async function readItems(deps: ExamDeps, setId: string): Promise<ItemRow[]> {
  const { data, error } = await deps.service
    .from("assessment_set_items")
    .select(ITEM_COLUMNS)
    .eq("set_id", setId)
    .order("position");
  if (error) throw new Error(`Could not read the paper's questions: ${error.message}`);
  return (data ?? []).map((row) => itemRow.parse(row));
}

async function readQuestions(
  deps: ExamDeps,
  ids: readonly string[],
): Promise<{
  questions: Map<string, PublicQuestion>;
  keys: Map<string, QuestionKey>;
  topics: Map<string, { topic: string; objective: string }>;
}> {
  const unique = [...new Set(ids)];
  const [qs, ks] = await Promise.all([
    deps.service.from("questions").select(QUESTION_COLUMNS).in("id", unique),
    deps.service.from("question_keys").select(KEY_COLUMNS).in("question_id", unique),
  ]);
  if (qs.error) throw new Error(`Could not read the questions: ${qs.error.message}`);
  if (ks.error) throw new Error(`Could not read the answer keys: ${ks.error.message}`);
  const questions = new Map<string, PublicQuestion>();
  const keys = new Map<string, QuestionKey>();
  const topics = new Map<string, { topic: string; objective: string }>();
  const stored = new Map(
    (qs.data ?? []).map((row) => {
      const q = storedQuestionSchema.parse(row);
      return [q.id, q] as const;
    }),
  );
  for (const [id, q] of stored) {
    questions.set(id, toPublicQuestion(q));
    topics.set(id, { topic: q.topic_code, objective: q.learning_objective_id });
  }
  for (const row of ks.data ?? []) {
    const key = storedKeySchema.parse(row);
    const q = stored.get(key.question_id);
    if (q) keys.set(q.id, toQuestionKey(q, key));
  }
  return { questions, keys, topics };
}

const citationOf = (plan: PaperPlan): string =>
  `${plan.documentTitle}${(plan.citation.label ?? plan.citation.page) ? `, page ${plan.citation.label ?? plan.citation.page}` : ""}`;

// ── starting ────────────────────────────────────────────────────────────────────────────────────

export async function startPaper(
  deps: ExamDeps,
  input: {
    learnerId: string;
    paperNumber: 1 | 2;
    length: PaperLength;
    /** Skill shares chosen by an adult; the official grid by default. */
    proportions?: Proportions;
    /** For tests: a fixed seed. */
    seed?: string;
  },
): Promise<string> {
  const { service } = deps;
  const grade = await getLearnerGrade(service, input.learnerId);
  const structure = await loadStructure(service);
  let plan: PaperPlan;
  try {
    plan = buildPlan(structure, {
      paperNumber: input.paperNumber,
      length: input.length,
      ...(input.proportions ? { proportions: input.proportions } : {}),
    });
  } catch (error) {
    throw new ExamError(
      "INVALID",
      error instanceof Error ? error.message : "That paper cannot be built.",
    );
  }

  const path = await cachedPath(service);
  const practicable = practicableObjectiveIds(path);
  const objectives = path
    .forGrade(grade)
    .filter((o) => practicable.has(o.id))
    .map(toObjectiveInfo);

  const seed = input.seed ?? `${input.learnerId}|${clock(deps).toISOString()}|${Math.random()}`;
  const pool = buildPool({ objectives, templates: deps.templates ?? ALL_TEMPLATES, seed });
  let paper;
  try {
    paper = assemble(plan, pool, new Rng(`${seed}|assemble`));
  } catch (error) {
    if (error instanceof NotEnoughQuestions) throw new ExamError("NOT_ENOUGH", error.message);
    throw error;
  }

  // keep every chosen question in the bank (the same question keeps the same id), a few at a time
  const ids: string[] = [];
  for (let i = 0; i < paper.items.length; i += 8) {
    const chunk = paper.items.slice(i, i + 8);
    ids.push(...(await Promise.all(chunk.map((item) => deps.bank.save(item.candidate.payload)))));
  }

  const { data, error } = await service.rpc("exam_start", {
    p_learner: input.learnerId,
    p_set: {
      kind: plan.kind,
      grade,
      paper_number: plan.paperNumber,
      paper_length: plan.length,
      target_proportions: plan.proportions,
      achieved_proportions: paper.achieved,
      marks_available: plan.countedMarks,
      recommended_minutes: plan.recommendedMinutes,
      plan: { plan, achieved: paper.achieved, shortfalls: paper.shortfalls },
    },
    p_items: paper.items.map((item, i) => ({
      position: i + 1,
      question_id: ids[i],
      marks: item.marks,
      skill: item.candidate.skill,
      section: item.section,
      question_number: item.number,
      part: item.part,
    })),
  });
  if (error) {
    if (error.code === "PT409")
      throw new ExamError("ACTIVE_PAPER", "You already have a paper in progress. Finish it first.");
    throw new Error(`Could not start the paper: ${error.message}`);
  }
  deps.onEvent?.({
    type: "paper_started",
    kind: plan.kind,
    length: plan.length,
    items: paper.items.length,
    shortfalls: paper.shortfalls.length,
  });
  return data as string;
}

// ── looking ─────────────────────────────────────────────────────────────────────────────────────

function ownedBy(row: SetRow, learnerId: string): void {
  if (row.learner_id !== learnerId)
    throw new ExamError("FORBIDDEN", "That paper belongs to someone else.");
}

export async function findOpenPaper(deps: ExamDeps, learnerId: string): Promise<string | null> {
  const { data, error } = await deps.service
    .from("assessment_sets")
    .select("id")
    .eq("learner_id", learnerId)
    .eq("status", "IN_PROGRESS")
    .maybeSingle();
  if (error) throw new Error(`Could not look for a paper in progress: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

export async function getPaperView(
  deps: ExamDeps,
  input: { setId: string; learnerId: string },
): Promise<PaperView> {
  const row = await readSet(deps, input.setId);
  ownedBy(row, input.learnerId);
  const parsed = storedPlan.safeParse(row.plan);
  if (!parsed.success || row.paper_number === null)
    throw new ExamError("INVALID", "That paper is not a practice paper.");
  const { plan, achieved, shortfalls } = parsed.data;
  const items = await readItems(deps, row.id);
  const { questions, keys } = await readQuestions(
    deps,
    items.map((i) => i.question_id),
  );
  const marked = row.status === "COMPLETED";
  const result = marked ? await resultView(deps, row) : null;
  const counted = marked
    ? new Set((row.result as { counted?: string[] } | null)?.counted ?? [])
    : null;

  const sections = plan.sections.map((section) => {
    const inSection = items.filter((i) => i.section === section.id);
    const numbers = [...new Set(inSection.map((i) => i.question_number))].sort((a, b) => a - b);
    return {
      id: section.id,
      label: section.label,
      offered: section.offered,
      counted: section.counted,
      questions: numbers.map((number): QuestionView => {
        const parts = inSection
          .filter((i) => i.question_number === number)
          .sort((a, b) => a.part - b.part);
        return {
          section: section.id,
          number,
          marks: parts.reduce((n, p) => n + p.marks, 0),
          counted: counted ? counted.has(`${section.id}:${number}`) : null,
          parts: parts.map((p): PartView => {
            const question = questions.get(p.question_id);
            if (!question) throw new Error(`Question ${p.question_id} of the paper is missing`);
            const key = keys.get(p.question_id);
            const saved = (p.answer ?? null) as LearnerAnswer | null;
            return {
              position: p.position,
              part: p.part,
              marks: p.marks,
              question,
              saved,
              review:
                marked && key
                  ? {
                      awarded: p.awarded ?? 0,
                      yourAnswer: saved === null ? null : describeLearnerAnswer(saved, question),
                      rightAnswer: answerAsText(key, question),
                      explanation: key.explanation,
                    }
                  : null,
            };
          }),
        };
      }),
    };
  });

  return {
    id: row.id,
    status: row.status,
    grade: row.grade,
    kind: plan.kind,
    paperNumber: row.paper_number as 1 | 2,
    length: row.paper_length,
    title: plan.title,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    recommendedMinutes: row.recommended_minutes,
    marksAvailable: row.marks_available ?? plan.countedMarks,
    sections,
    shares: {
      target: plan.proportions,
      official: plan.officialProportions,
      achieved: achieved as Proportions,
      shortfalls,
    },
    citation: citationOf(plan),
    answered: items.filter((i) => i.answer !== null).length,
    total: items.length,
    result,
  };
}

async function resultView(deps: ExamDeps, row: SetRow): Promise<ResultView | null> {
  const stored = row.result as (PaperResult & { counted: string[] }) | null;
  if (!stored) return null;
  const path = await cachedPath(deps.service);
  return {
    marksAwarded: stored.marksAwarded,
    marksAvailable: stored.marksAvailable,
    percent: stored.percent,
    bands: stored.bands.map((b) => ({ ...b, label: BAND_LABELS[b.band] })),
    topics: stored.topics,
    unanswered: stored.unanswered,
    revisit: stored.revisit.slice(0, 8).map((r) => ({
      objectiveId: r.objectiveId,
      text: path.byId.get(r.objectiveId)?.text ?? r.objectiveId,
      lost: r.lost,
    })),
    misconceptions: stored.misconceptions.slice(0, 6).map((m) => ({
      tag: m.tag,
      name: getMisconception(m.tag)?.name ?? m.tag,
      count: m.count,
    })),
  };
}

// ── answering ───────────────────────────────────────────────────────────────────────────────────

export async function saveAnswer(
  deps: ExamDeps,
  input: { setId: string; learnerId: string; position: number; answer: LearnerAnswer },
): Promise<void> {
  const row = await readSet(deps, input.setId);
  ownedBy(row, input.learnerId);
  if (row.status !== "IN_PROGRESS")
    throw new ExamError("FINISHED", "That paper has been marked already.");
  if (!answerIsReasonable(input.answer)) throw new ExamError("INVALID", "That answer is too long.");
  const { data, error } = await deps.service
    .from("assessment_set_items")
    .update({ answer: answerForStorage(input.answer), answered_at: clock(deps).toISOString() })
    .eq("set_id", input.setId)
    .eq("position", input.position)
    .select("position");
  if (error) throw new Error(`Could not save the answer: ${error.message}`);
  if (!data || data.length === 0)
    throw new ExamError("NOT_FOUND", "That question is not in this paper.");
}

// ── finishing ───────────────────────────────────────────────────────────────────────────────────

export async function finishPaper(
  deps: ExamDeps,
  input: { setId: string; learnerId: string },
): Promise<PaperView> {
  const row = await readSet(deps, input.setId);
  ownedBy(row, input.learnerId);
  if (row.status === "COMPLETED") return getPaperView(deps, input); // already marked: say so, change nothing

  const parsed = storedPlan.parse(row.plan);
  const now = clock(deps);

  // 1. mark everything in memory (nothing is written yet)
  const items = await readItems(deps, row.id);
  const { keys, topics } = await readQuestions(
    deps,
    items.map((i) => i.question_id),
  );
  const marked = items.map((item) => {
    const key = keys.get(item.question_id);
    const meta = topics.get(item.question_id);
    if (!key || !meta) throw new Error(`Question ${item.question_id} of the paper is missing`);
    const answered = item.answer !== null && item.answer !== undefined;
    const checked = answered ? checkAnswer(key, item.answer as LearnerAnswer) : null;
    const awarded = checked ? Math.max(0, Math.min(1, checked.result.score)) : 0;
    const resultItem: ResultItem = {
      section: item.section,
      number: item.question_number,
      part: item.part,
      marks: item.marks,
      band: BAND_OF[item.skill as keyof typeof BAND_OF],
      topicCode: meta.topic,
      objectiveId: meta.objective,
      awarded,
      answered,
      tags: checked && awarded < 1 ? checked.tags : [],
    };
    return { item, key, checked, resultItem };
  });
  const result = summarise(
    parsed.plan,
    marked.map((m) => m.resultItem),
  );

  // 2. only one caller can move the paper from IN_PROGRESS to COMPLETED: a double click marks it once
  const { data: moved, error: moveError } = await deps.service
    .from("assessment_sets")
    .update({ status: "COMPLETED", completed_at: now.toISOString() })
    .eq("id", row.id)
    .eq("status", "IN_PROGRESS")
    .select("id");
  if (moveError) throw new Error(`Could not finish the paper: ${moveError.message}`);
  if (!moved || moved.length === 0) return getPaperView(deps, input);

  // 3. what was awarded, item by item, and the result as a whole. If this fails the paper goes back to
  //    being in progress, so that the child can finish it again instead of finding it "marked" and empty.
  try {
    const { error: itemsError } = await deps.service.from("assessment_set_items").upsert(
      marked.map((m) => ({
        set_id: row.id,
        position: m.item.position,
        question_id: m.item.question_id,
        marks: m.item.marks,
        skill: m.item.skill,
        section: m.item.section,
        question_number: m.item.question_number,
        part: m.item.part,
        answer: m.item.answer ?? null,
        awarded: Math.round(m.resultItem.awarded * 1000) / 1000,
        tags: m.resultItem.tags,
      })),
    );
    if (itemsError) throw new Error(`Could not save the marks: ${itemsError.message}`);
    const { error: setError } = await deps.service
      .from("assessment_sets")
      .update({
        marks_awarded: result.marksAwarded,
        marks_available: result.marksAvailable,
        achieved_proportions: parsed.achieved,
        result,
      })
      .eq("id", row.id);
    if (setError) throw new Error(`Could not save the result: ${setError.message}`);
  } catch (error) {
    await deps.service
      .from("assessment_sets")
      .update({ status: "IN_PROGRESS", completed_at: null })
      .eq("id", row.id)
      .eq("status", "COMPLETED");
    throw error;
  }

  // 4. what the child answered is evidence about what they know, like an answer in a lesson. The paper
  //    is already marked, so a failure here is reported, not shown to the child as a failed paper.
  try {
    const attempts = marked
      .filter((m) => m.checked)
      .map((m) => ({
        learner_id: row.learner_id,
        question_id: m.item.question_id,
        objective_id: m.resultItem.objectiveId,
        session_id: null,
        attempt_number: 1,
        answer: m.item.answer,
        is_correct: m.checked!.result.correct,
        score: Math.round(m.resultItem.awarded * 1000) / 1000,
        hints_used: 0,
        marking_method: m.checked!.result.method,
        marking_detail: m.checked!.result.detail,
        misconception_tags: m.resultItem.tags,
        difficulty: m.key.difficulty,
      }));
    if (attempts.length > 0) {
      const { error } = await deps.service.from("question_attempts").insert(attempts);
      if (error) throw new Error(`Could not record the answers: ${error.message}`);
    }
    for (const m of marked) {
      if (!m.checked) continue;
      await recordObservation(deps.service, {
        learnerId: row.learner_id,
        objectiveId: m.resultItem.objectiveId,
        questionId: m.item.question_id,
        observation: {
          outcome: m.resultItem.awarded >= 0.999 ? "CORRECT" : "INCORRECT",
          difficulty: m.key.difficulty,
          hintsUsed: 0,
          attemptNumber: 1,
          questionType: m.key.type,
          at: now,
        },
      });
    }
  } catch {
    deps.onEvent?.({ type: "paper_evidence_failed" });
  }

  deps.onEvent?.({
    type: "paper_finished",
    percent: result.percent,
    marks: result.marksAwarded,
    of: result.marksAvailable,
  });
  return getPaperView(deps, input);
}

// ── listing ─────────────────────────────────────────────────────────────────────────────────────

export interface PaperSummary {
  id: string;
  kind: PaperKind;
  paperNumber: 1 | 2;
  length: PaperLength;
  status: "IN_PROGRESS" | "COMPLETED";
  startedAt: string;
  completedAt: string | null;
  marksAwarded: number | null;
  marksAvailable: number | null;
  percent: number | null;
  bands: Array<{ band: SkillBand; percent: number }>;
}

/** A learner's papers, newest first. `db` may be the learner's own client or a guardian's (row-level security decides). */
export async function listPapers(
  db: SupabaseClient,
  learnerId: string,
  limit = 10,
): Promise<PaperSummary[]> {
  const { data, error } = await db
    .from("assessment_sets")
    .select(
      "id, kind, paper_number, paper_length, status, started_at, completed_at, marks_awarded, marks_available, result",
    )
    .eq("learner_id", learnerId)
    .in("kind", ["EXAM_STYLE_PAPER_1", "EXAM_STYLE_PAPER_2"])
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not read the papers: ${error.message}`);
  return (data ?? []).map((row) => {
    const result = row.result as Partial<PaperResult> | null;
    const awarded = row.marks_awarded === null ? null : Number(row.marks_awarded);
    const available = row.marks_available as number | null;
    return {
      id: row.id as string,
      kind: row.kind as PaperKind,
      paperNumber: (row.paper_number as 1 | 2) ?? 1,
      length: row.paper_length as PaperLength,
      status: row.status as "IN_PROGRESS" | "COMPLETED",
      startedAt: row.started_at as string,
      completedAt: (row.completed_at as string | null) ?? null,
      marksAwarded: awarded,
      marksAvailable: available,
      percent: awarded !== null && available ? Math.round((awarded / available) * 1000) / 10 : null,
      bands: (result?.bands ?? []).map((b) => ({ band: b.band, percent: b.percent })),
    };
  });
}
