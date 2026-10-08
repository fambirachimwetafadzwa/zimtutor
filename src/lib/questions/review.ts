import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  QUESTION_COLUMNS,
  storedKeySchema,
  storedQuestionSchema,
  toPublicQuestion,
  KEY_COLUMNS,
  type PublicQuestion,
  type StoredKey,
  type StoredQuestion,
} from "./bank-rows";
import { answerAsText } from "../tutor/answers";

/**
 * Reviewing the questions ZimTutor made. They start UNVERIFIED (a template wrote them; nobody has
 * looked). An administrator can approve one (ADMIN_REVIEWED: the child then sees "checked by a
 * teacher"), reject one (REJECTED and RETIRED: it is never asked again) or reopen a decision.
 *
 * Listing uses the administrator's own session (row-level security lets administrators read
 * questions, never keys); reading the KEY to check an answer, and every change, use the service-role
 * client after the administrator has been verified. Changes are audited with the state before and
 * after.
 */

export const REVIEW_ACTIONS = ["APPROVE", "REJECT", "REOPEN"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export interface ReviewState {
  verification: "UNVERIFIED" | "ADMIN_REVIEWED" | "REJECTED";
  status: "ACTIVE" | "RETIRED" | "NEEDS_REVIEW";
}

/** Where a question goes after a decision; null when the decision changes nothing. */
export function nextReviewState(current: ReviewState, action: ReviewAction): ReviewState | null {
  const next: ReviewState =
    action === "APPROVE"
      ? { verification: "ADMIN_REVIEWED", status: "ACTIVE" }
      : action === "REJECT"
        ? { verification: "REJECTED", status: "RETIRED" }
        : { verification: "UNVERIFIED", status: "ACTIVE" };
  return next.verification === current.verification && next.status === current.status ? null : next;
}

export const reviewQuestionSchema = z.object({
  questionId: z.uuid(),
  action: z.enum(REVIEW_ACTIONS),
});

// ── listing ─────────────────────────────────────────────────────────────────────────────────────

export const FILTERS = {
  verification: ["UNVERIFIED", "ADMIN_REVIEWED", "REJECTED"],
  grade: ["3", "4", "5", "6", "7"],
  type: [
    "MULTIPLE_CHOICE",
    "NUMERIC",
    "SHORT_ANSWER",
    "WORKED_CALCULATION",
    "TRUE_FALSE",
    "ORDERING",
    "MATCHING",
    "FILL_IN_THE_BLANK",
    "WORD_PROBLEM",
    "VISUAL_DIAGRAM",
    "DATA_INTERPRETATION",
  ],
} as const;

export interface QuestionFilter {
  verification?: string;
  grade?: number;
  type?: string;
  objective?: string;
  template?: string;
  page: number;
}

export const PAGE_SIZE = 15;

export interface ReviewRow {
  question: PublicQuestion;
  generator: string;
  status: string;
  verification: string;
  objectiveText: string;
}

export interface ReviewPage {
  rows: ReviewRow[];
  total: number;
  page: number;
  pages: number;
}

/** A search term safe to put into a LIKE pattern. */
const likeTerm = (text: string): string => text.replace(/[%_\\,()]/g, " ").trim();

export async function listQuestions(
  db: SupabaseClient,
  filter: QuestionFilter,
): Promise<ReviewPage> {
  let query = db
    .from("questions")
    .select(QUESTION_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false });
  if (filter.verification) query = query.eq("verification_status", filter.verification);
  if (filter.grade) query = query.eq("grade", filter.grade);
  if (filter.type) query = query.eq("question_type", filter.type);
  if (filter.objective) {
    const term = likeTerm(filter.objective);
    if (term) query = query.ilike("learning_objective_id", `${term}%`);
  }
  if (filter.template) {
    const term = likeTerm(filter.template);
    if (term) query = query.ilike("generator", `template:${term}%`);
  }
  const from = (filter.page - 1) * PAGE_SIZE;
  const { data, count, error } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(`Could not read the questions: ${error.message}`);

  const stored = (data ?? []).map((row) => storedQuestionSchema.parse(row));
  const objectiveIds = [...new Set(stored.map((q) => q.learning_objective_id))];
  const { data: objectives } = objectiveIds.length
    ? await db.from("learning_objectives").select("id, text").in("id", objectiveIds)
    : { data: [] };
  const textById = new Map((objectives ?? []).map((o) => [o.id as string, o.text as string]));

  const total = count ?? 0;
  return {
    rows: stored.map((q) => ({
      question: toPublicQuestion(q),
      generator: q.generator,
      status: q.status,
      verification: q.verification_status,
      objectiveText: textById.get(q.learning_objective_id) ?? "",
    })),
    total,
    page: filter.page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** How many questions are waiting for a person to look at them. */
export async function countUnverified(db: SupabaseClient): Promise<number> {
  const { count, error } = await db
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("verification_status", "UNVERIFIED")
    .eq("status", "ACTIVE");
  if (error) throw new Error(`Could not count the questions: ${error.message}`);
  return count ?? 0;
}

/** What a reviewer needs to check a question's marking: the right answer, the hints, the explanation. */
export interface ReviewKey {
  answer: string;
  hints: string[];
  explanation: string;
}

/** Keys for a page of questions. SERVICE ROLE: call only after the administrator is verified. */
export async function readKeys(
  service: SupabaseClient,
  rows: readonly ReviewRow[],
): Promise<Map<string, ReviewKey>> {
  const ids = rows.map((r) => r.question.id);
  if (ids.length === 0) return new Map();
  const { data, error } = await service
    .from("question_keys")
    .select(KEY_COLUMNS)
    .in("question_id", ids);
  if (error) throw new Error(`Could not read the answer keys: ${error.message}`);
  const keys = new Map<string, StoredKey>();
  for (const row of data ?? []) {
    const key = storedKeySchema.parse(row);
    keys.set(key.question_id, key);
  }
  const out = new Map<string, ReviewKey>();
  for (const row of rows) {
    const key = keys.get(row.question.id);
    if (!key) continue;
    out.set(row.question.id, {
      answer: answerAsText(key.expected_answer, row.question),
      hints: key.hints,
      explanation: key.explanation,
    });
  }
  return out;
}

// ── deciding ────────────────────────────────────────────────────────────────────────────────────

export type DecisionResult = { ok: true; changed: boolean } | { ok: false; error: string };

/** Apply an administrator's decision to a question. SERVICE ROLE: only after the admin is verified. */
export async function decideQuestion(
  service: SupabaseClient,
  adminId: string,
  input: z.infer<typeof reviewQuestionSchema>,
): Promise<DecisionResult> {
  const { data: row } = await service
    .from("questions")
    .select("id, status, verification_status, source_type")
    .eq("id", input.questionId)
    .maybeSingle();
  if (!row) return { ok: false, error: "That question does not exist." };
  if (row.source_type !== "SUPPLEMENTAL")
    return { ok: false, error: "Only ZimTutor's own practice questions are reviewed here." };

  const current: ReviewState = {
    verification: row.verification_status as ReviewState["verification"],
    status: row.status as ReviewState["status"],
  };
  const next = nextReviewState(current, input.action);
  if (!next) return { ok: true, changed: false };

  const { error } = await service
    .from("questions")
    .update({ verification_status: next.verification, status: next.status })
    .eq("id", input.questionId);
  if (error) return { ok: false, error: "We couldn't save that. Please try again." };

  const { error: auditError } = await service.from("admin_audit_log").insert({
    admin_id: adminId,
    action: `QUESTION_${input.action === "APPROVE" ? "APPROVED" : input.action === "REJECT" ? "REJECTED" : "REOPENED"}`,
    entity_type: "question",
    entity_id: input.questionId,
    before_state: current,
    after_state: next,
  });
  if (auditError) throw new Error(`Could not write the audit log: ${auditError.message}`);
  return { ok: true, changed: true };
}

export type { StoredQuestion };
