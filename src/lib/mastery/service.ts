import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  applyObservation,
  markIntroduced,
  MASTERY_STATES,
  newMasteryRecord,
  type Difficulty,
  type MasteryEvent,
  type MasteryRecord,
  type Observation,
} from "./engine";

/**
 * Persistence for the mastery engine. WRITES use the service-role client (learners cannot award
 * themselves mastery: they have no write privilege on these tables) and are only ever called after
 * the server has authenticated the learner and marked the answer. READS may use the caller's own
 * client: row-level security shows a learner their own records, a parent their children's, and no
 * one anyone else's.
 *
 * Concurrency: the engine is a pure function, so an update is read → compute → write-if-unchanged.
 * If another request changed the row in between, the write matches nothing and the whole step is
 * repeated against the fresh row.
 */

const COLUMNS =
  "learner_id, objective_id, mastery_score, attempts, correct_attempts, incorrect_attempts, recent_accuracy, recent_outcomes, last_attempt_at, difficulty, confidence, current_state, state_changed_at, first_seen_at, mastered_at, hard_correct, review_stage, updated_at";

const rowSchema = z.object({
  learner_id: z.string(),
  objective_id: z.string(),
  mastery_score: z.coerce.number(),
  attempts: z.number().int(),
  correct_attempts: z.number().int(),
  incorrect_attempts: z.number().int(),
  recent_accuracy: z.coerce.number().nullable(),
  recent_outcomes: z.array(z.boolean()),
  last_attempt_at: z.string().nullable(),
  difficulty: z.number().int().min(1).max(5),
  confidence: z.coerce.number(),
  current_state: z.enum(MASTERY_STATES),
  state_changed_at: z.string(),
  first_seen_at: z.string(),
  mastered_at: z.string().nullable(),
  hard_correct: z.number().int(),
  review_stage: z.number().int(),
  updated_at: z.string(),
});
type Row = z.infer<typeof rowSchema>;

export function fromRow(row: Row): MasteryRecord {
  return {
    masteryScore: row.mastery_score,
    attempts: row.attempts,
    correctAttempts: row.correct_attempts,
    incorrectAttempts: row.incorrect_attempts,
    recentOutcomes: row.recent_outcomes,
    recentAccuracy: row.recent_accuracy,
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at) : null,
    difficulty: row.difficulty as Difficulty,
    confidence: row.confidence,
    currentState: row.current_state,
    stateChangedAt: new Date(row.state_changed_at),
    firstSeenAt: new Date(row.first_seen_at),
    masteredAt: row.mastered_at ? new Date(row.mastered_at) : null,
    hardCorrect: row.hard_correct,
    reviewStage: row.review_stage,
  };
}

export function toRow(record: MasteryRecord) {
  return {
    mastery_score: record.masteryScore,
    attempts: record.attempts,
    correct_attempts: record.correctAttempts,
    incorrect_attempts: record.incorrectAttempts,
    recent_accuracy: record.recentAccuracy,
    recent_outcomes: record.recentOutcomes,
    last_attempt_at: record.lastAttemptAt?.toISOString() ?? null,
    difficulty: record.difficulty,
    confidence: record.confidence,
    current_state: record.currentState,
    state_changed_at: record.stateChangedAt.toISOString(),
    first_seen_at: record.firstSeenAt.toISOString(),
    mastered_at: record.masteredAt?.toISOString() ?? null,
    hard_correct: record.hardCorrect,
    review_stage: record.reviewStage,
  };
}

export class MasteryConflictError extends Error {
  constructor() {
    super("The mastery record kept changing; giving up after several attempts.");
    this.name = "MasteryConflictError";
  }
}

const MAX_ATTEMPTS = 5;

async function load(
  db: SupabaseClient,
  learnerId: string,
  objectiveId: string,
): Promise<Row | null> {
  const { data, error } = await db
    .from("learner_objective_mastery")
    .select(COLUMNS)
    .eq("learner_id", learnerId)
    .eq("objective_id", objectiveId)
    .maybeSingle();
  if (error) throw new Error(`Could not read mastery: ${error.message}`);
  return data ? rowSchema.parse(data) : null;
}

/** Read → compute → write-if-unchanged, repeated on conflict. `compute` must be pure. */
async function update(
  service: SupabaseClient,
  learnerId: string,
  objectiveId: string,
  now: Date,
  compute: (record: MasteryRecord) => { record: MasteryRecord; event?: MasteryEvent },
): Promise<{ record: MasteryRecord; event?: MasteryEvent }> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const existing = await load(service, learnerId, objectiveId);
    const before = existing ? fromRow(existing) : newMasteryRecord(now);
    const result = compute(before);
    const row = { ...toRow(result.record), updated_at: now.toISOString() };

    if (!existing) {
      const { error } = await service
        .from("learner_objective_mastery")
        .insert({ learner_id: learnerId, objective_id: objectiveId, ...row });
      if (!error) return result;
      if (error.code !== "23505") throw new Error(`Could not create mastery: ${error.message}`); // 23505: someone else just created it
      continue;
    }
    const { data, error } = await service
      .from("learner_objective_mastery")
      .update(row)
      .eq("learner_id", learnerId)
      .eq("objective_id", objectiveId)
      .eq("updated_at", existing.updated_at)
      .select("learner_id");
    if (error) throw new Error(`Could not update mastery: ${error.message}`);
    if (data && data.length === 1) return result;
  }
  throw new MasteryConflictError();
}

/** Apply one resolved question to the learner's record and append it to the history. */
export async function recordObservation(
  service: SupabaseClient,
  input: {
    learnerId: string;
    objectiveId: string;
    questionId?: string | null;
    observation: Observation;
  },
): Promise<{ record: MasteryRecord; event: MasteryEvent }> {
  const { record, event } = await update(
    service,
    input.learnerId,
    input.objectiveId,
    input.observation.at,
    (before) => applyObservation(before, input.observation),
  );
  if (!event) throw new Error("unreachable: an observation always produces an event");
  const { error } = await service.from("mastery_events").insert({
    learner_id: input.learnerId,
    objective_id: input.objectiveId,
    question_id: input.questionId ?? null,
    evidence: event.evidence,
    score_before: event.scoreBefore,
    score_after: event.scoreAfter,
    state_before: event.stateBefore,
    state_after: event.stateAfter,
    reason: event.reason,
  });
  if (error) throw new Error(`Could not record the mastery event: ${error.message}`);
  return { record, event };
}

/** The learner has been shown the objective's explanation. */
export async function recordIntroduced(
  service: SupabaseClient,
  learnerId: string,
  objectiveId: string,
  now = new Date(),
): Promise<MasteryRecord> {
  return (
    await update(service, learnerId, objectiveId, now, (before) => ({
      record: markIntroduced(before, now),
    }))
  ).record;
}

/** Records for a learner (RLS decides what the caller may see). Objectives never seen are simply absent. */
export async function getMastery(
  db: SupabaseClient,
  learnerId: string,
  objectiveIds?: string[],
): Promise<Map<string, MasteryRecord>> {
  let query = db
    .from("learner_objective_mastery")
    .select(COLUMNS)
    .eq("learner_id", learnerId)
    .limit(5000);
  if (objectiveIds && objectiveIds.length > 0) query = query.in("objective_id", objectiveIds);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read mastery: ${error.message}`);
  return new Map(
    z
      .array(rowSchema)
      .parse(data)
      .map((row) => [row.objective_id, fromRow(row)]),
  );
}
