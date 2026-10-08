import type { SupabaseClient } from "@supabase/supabase-js";
import { generateQuestion, type VerifiedQuestion } from "./generate";
import {
  KEY_COLUMNS,
  QUESTION_COLUMNS,
  storedKeySchema,
  storedQuestionSchema,
  toBankInsert,
  toPublicQuestion,
  toQuestionKey,
  type PublicQuestion,
  type QuestionKey,
  type StoredKey,
  type StoredQuestion,
} from "./bank-rows";
import { Rng } from "./rng";
import { ALL_TEMPLATES } from "./templates";
import type { Difficulty, ObjectiveInfo, QuestionTemplate } from "./types";

/**
 * The question bank: saving generated questions, reading them back for a learner's screen, reading
 * the answer key for marking, and choosing the next question for an objective.
 *
 * All access goes through a `BankStore` so that the choosing logic can be tested without a database.
 * The Supabase store uses the SERVICE-ROLE client: learners cannot read questions or keys directly,
 * and nothing here is called before the server has authenticated the learner.
 */

export interface BankStore {
  /** Store a generated question and its key; returns the question id (the same one for the same content). */
  save(question: VerifiedQuestion): Promise<string>;
  /** Questions this learner answered most recently for the objective, newest first. */
  recentQuestionIds(learnerId: string, objectiveId: string, limit: number): Promise<string[]>;
  /** Active stored questions for an objective at a difficulty. */
  candidates(objectiveId: string, difficulty: Difficulty, limit: number): Promise<StoredQuestion[]>;
  question(id: string): Promise<StoredQuestion | null>;
  key(id: string): Promise<StoredKey | null>;
}

export class SupabaseBankStore implements BankStore {
  constructor(private readonly service: SupabaseClient) {}

  async save(question: VerifiedQuestion): Promise<string> {
    const { question: q, key } = toBankInsert(question);
    const { data, error } = await this.service.rpc("bank_save_question", {
      p_question: q,
      p_key: key,
    });
    if (error || typeof data !== "string")
      throw new Error(`Could not save the question: ${error?.message ?? "no id returned"}`);
    return data;
  }

  async recentQuestionIds(
    learnerId: string,
    objectiveId: string,
    limit: number,
  ): Promise<string[]> {
    const { data, error } = await this.service
      .from("question_attempts")
      .select("question_id")
      .eq("learner_id", learnerId)
      .eq("objective_id", objectiveId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Could not read recent questions: ${error.message}`);
    return [...new Set((data ?? []).map((r) => r.question_id as string))];
  }

  async candidates(
    objectiveId: string,
    difficulty: Difficulty,
    limit: number,
  ): Promise<StoredQuestion[]> {
    const { data, error } = await this.service
      .from("questions")
      .select(QUESTION_COLUMNS)
      .eq("learning_objective_id", objectiveId)
      .eq("difficulty", difficulty)
      .eq("status", "ACTIVE")
      .neq("verification_status", "REJECTED")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Could not read questions: ${error.message}`);
    return (data ?? []).map((row) => storedQuestionSchema.parse(row));
  }

  async question(id: string): Promise<StoredQuestion | null> {
    const { data, error } = await this.service
      .from("questions")
      .select(QUESTION_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Could not read the question: ${error.message}`);
    return data ? storedQuestionSchema.parse(data) : null;
  }

  async key(id: string): Promise<StoredKey | null> {
    const { data, error } = await this.service
      .from("question_keys")
      .select(KEY_COLUMNS)
      .eq("question_id", id)
      .maybeSingle();
    if (error) throw new Error(`Could not read the answer key: ${error.message}`);
    return data ? storedKeySchema.parse(data) : null;
  }
}

/** The question as a learner's screen may see it (no answer, hints or explanation). */
export async function getPublicQuestion(
  store: BankStore,
  id: string,
): Promise<PublicQuestion | null> {
  const row = await store.question(id);
  return row ? toPublicQuestion(row) : null;
}

/** The answer key for marking. Server-side only. */
export async function getQuestionKey(store: BankStore, id: string): Promise<QuestionKey | null> {
  const [row, key] = await Promise.all([store.question(id), store.key(id)]);
  return row && key ? toQuestionKey(row, key) : null;
}

export interface PickInput {
  learnerId: string;
  objective: ObjectiveInfo;
  difficulty: Difficulty;
  templates?: readonly QuestionTemplate[];
  /** A seed, for repeatable tests. By default a fresh random one. */
  seed?: string;
  /** How many of the learner's latest questions on this objective not to repeat. */
  avoid?: number;
  /** Further question ids not to use (for example, already asked in this session). */
  exclude?: readonly string[];
  /**
   * With at least this many stored questions to choose from, one of them is reused; with fewer, a
   * new one is made (so the bank grows, and children keep meeting new questions).
   */
  reuseFrom?: number;
}

export interface PickedQuestion {
  id: string;
  question: PublicQuestion;
  /** True when a stored question was reused. */
  reused: boolean;
}

const randomSeed = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Choose the next question for a learner on an objective: a stored one they have not met, or a new
 * one. Some objectives have only a few different questions at a level (converting hours to days);
 * when the learner has met them all recently, the one they met longest ago is used again, so the
 * answer to "give me a question" is never "there is none".
 */
export async function pickQuestion(store: BankStore, input: PickInput): Promise<PickedQuestion> {
  const { learnerId, objective, difficulty } = input;
  const seed = input.seed ?? randomSeed();
  const rng = new Rng(`${seed}|pick`);
  const recent = await store.recentQuestionIds(learnerId, objective.id, input.avoid ?? 30);
  const avoid = new Set([...recent, ...(input.exclude ?? [])]);

  const all = await store.candidates(objective.id, difficulty, 60);
  const unseen = all.filter((q) => !avoid.has(q.id));
  if (unseen.length >= (input.reuseFrom ?? 25)) {
    // teacher-checked questions first
    const reviewed = unseen.filter((q) => q.verification_status === "ADMIN_REVIEWED");
    const row = rng.pick(reviewed.length > 0 ? reviewed : unseen);
    return { id: row.id, question: toPublicQuestion(row), reused: true };
  }

  const templates = input.templates ?? ALL_TEMPLATES;
  for (let attempt = 0; attempt < 6; attempt++) {
    const made = generateQuestion({
      objective,
      difficulty,
      seed: `${seed}|${attempt}`,
      templates,
    });
    const id = await store.save(made);
    if (avoid.has(id)) continue; // the same content as a question the learner has just had
    const row = await store.question(id);
    if (!row) throw new Error("A question that was just saved cannot be read back");
    return { id, question: toPublicQuestion(row), reused: false };
  }

  // Nothing new: an unseen stored question, else the one the learner met longest ago.
  const choices = unseen.length > 0 ? unseen : all;
  const lastSeen = (id: string) => {
    const at = recent.indexOf(id);
    return at === -1 ? Number.POSITIVE_INFINITY : at; // bigger = longer ago
  };
  const row = [...choices]
    .filter((q) => !(input.exclude ?? []).includes(q.id))
    .sort((a, b) => lastSeen(b.id) - lastSeen(a.id))[0];
  if (row) return { id: row.id, question: toPublicQuestion(row), reused: true };
  throw new Error(`Could not find a question for ${objective.id} at difficulty ${difficulty}`);
}
