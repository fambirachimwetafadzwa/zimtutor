import { randomUUID } from "node:crypto";
import {
  storedKeySchema,
  storedQuestionSchema,
  toBankInsert,
  type StoredKey,
  type StoredQuestion,
} from "../../src/lib/questions/bank-rows";
import type { BankStore } from "../../src/lib/questions/bank";
import type { VerifiedQuestion } from "../../src/lib/questions/generate";
import { OBJECTIVES } from "./support";

/**
 * A bank held in memory, behaving like the database: the same content is stored once, rows are what
 * the database would hold (after a JSON round trip), and a learner's attempts are remembered.
 */
export class MemoryBankStore implements BankStore {
  readonly questions = new Map<string, StoredQuestion>();
  readonly keys = new Map<string, StoredKey>();
  private readonly byHash = new Map<string, string>();
  /** learnerId|objectiveId → question ids, oldest first. */
  readonly attempts = new Map<string, string[]>();
  saves = 0;

  async save(question: VerifiedQuestion): Promise<string> {
    this.saves++;
    const existing = this.byHash.get(question.contentHash);
    if (existing) return existing;
    const { question: q, key } = JSON.parse(JSON.stringify(toBankInsert(question))) as ReturnType<
      typeof toBankInsert
    >;
    const objective = OBJECTIVES.find((o) => o.id === q.learning_objective_id)!;
    const id = randomUUID();
    this.questions.set(
      id,
      storedQuestionSchema.parse({
        id,
        learning_objective_id: q.learning_objective_id,
        grade: objective.grade,
        topic_code: objective.topicCode,
        subtopic_id: objective.subtopicId,
        difficulty: q.difficulty,
        question_type: q.question_type,
        assessment_skill: q.assessment_skill,
        stem: q.stem,
        stem_data: q.stem_data,
        options: q.options,
        marking_method: q.marking_method,
        misconception_tags: q.misconception_tags,
        uses_local_context: q.uses_local_context,
        source_type: q.source_type,
        verification_status: q.verification_status,
        generator: q.generator,
        status: "ACTIVE",
        presentation: q.presentation,
      }),
    );
    this.keys.set(id, storedKeySchema.parse({ question_id: id, ...key }));
    this.byHash.set(question.contentHash, id);
    return id;
  }

  /** Record that a learner answered a question. */
  attempt(learnerId: string, objectiveId: string, questionId: string): void {
    const key = `${learnerId}|${objectiveId}`;
    this.attempts.set(key, [...(this.attempts.get(key) ?? []), questionId]);
  }

  async recentQuestionIds(
    learnerId: string,
    objectiveId: string,
    limit: number,
  ): Promise<string[]> {
    return [...(this.attempts.get(`${learnerId}|${objectiveId}`) ?? [])].reverse().slice(0, limit);
  }

  async candidates(
    objectiveId: string,
    difficulty: number,
    limit: number,
  ): Promise<StoredQuestion[]> {
    return [...this.questions.values()]
      .filter(
        (q) =>
          q.learning_objective_id === objectiveId &&
          q.difficulty === difficulty &&
          q.status === "ACTIVE" &&
          q.verification_status !== "REJECTED",
      )
      .slice(0, limit);
  }

  async question(id: string): Promise<StoredQuestion | null> {
    return this.questions.get(id) ?? null;
  }

  async key(id: string): Promise<StoredKey | null> {
    return this.keys.get(id) ?? null;
  }
}
