import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MASTERY_COLUMNS, fromRow, masteryRowSchema, toRow } from "../mastery/service";
import { PHASES, sessionStateSchema } from "./state";
import {
  ActiveSessionExistsError,
  StepConflictError,
  type MessageMeta,
  type SessionRow,
  type StepCommit,
  type StoredMessage,
  type TutorStore,
} from "./store";

/**
 * The tutor's storage in Supabase. WRITES use the service-role client (a learner has no write
 * privilege on any of these tables) and only ever run after the server has authenticated the learner.
 * Every lesson step goes through the database function `tutor_commit`, which applies the session's
 * new position, the messages, the marked attempt and the mastery update in ONE transaction.
 */

const SESSION_COLUMNS =
  "id, learner_id, objective_id, status, phase, state, rev, started_at, last_activity_at, ended_at";

const sessionRowSchema = z.object({
  id: z.string(),
  learner_id: z.string(),
  objective_id: z.string(),
  status: z.enum(["ACTIVE", "COMPLETED", "ABANDONED"]),
  phase: z.enum(PHASES),
  state: sessionStateSchema,
  rev: z.number().int(),
  started_at: z.string(),
  last_activity_at: z.string(),
  ended_at: z.string().nullable(),
});

function toSession(raw: unknown): SessionRow {
  const row = sessionRowSchema.parse(raw);
  return {
    id: row.id,
    learnerId: row.learner_id,
    objectiveId: row.objective_id,
    status: row.status,
    phase: row.phase,
    state: row.state,
    rev: row.rev,
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
    endedAt: row.ended_at,
  };
}

const MESSAGE_COLUMNS = "id, seq, role, kind, content, question_id, flagged, meta, created_at";

const messageRowSchema = z.object({
  id: z.string(),
  seq: z.coerce.number(),
  role: z.enum(["tutor", "learner", "system"]),
  kind: z.string(),
  content: z.string(),
  question_id: z.string().nullable(),
  flagged: z.boolean(),
  meta: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

/** The arguments of the database function `tutor_commit` for one lesson step. */
export function commitParams(step: StepCommit) {
  return {
    p_session_id: step.sessionId,
    p_expected_rev: step.expectedRev,
    p_phase: step.phase,
    p_state: step.state,
    p_status: step.status,
    p_summary: step.summary ?? null,
    p_messages: step.messages.map((m) => ({
      role: m.role,
      kind: m.kind,
      content: m.content,
      question_id: m.questionId ?? null,
      flagged: m.flagged ?? false,
      meta: m.meta ?? {},
    })),
    p_attempt: step.attempt
      ? {
          question_id: step.attempt.questionId,
          objective_id: step.attempt.objectiveId,
          attempt_number: step.attempt.attemptNumber,
          answer: step.attempt.answer,
          is_correct: step.attempt.isCorrect,
          score: step.attempt.score,
          hints_used: step.attempt.hintsUsed,
          marking_method: step.attempt.markingMethod,
          marking_detail: step.attempt.markingDetail,
          misconception_tags: step.attempt.misconceptionTags,
          time_taken_ms: step.attempt.timeTakenMs,
          difficulty: step.attempt.difficulty,
        }
      : null,
    p_mastery: step.mastery
      ? {
          objective_id: step.mastery.objectiveId,
          expected_updated_at: step.mastery.expectedVersion,
          row: toRow(step.mastery.record),
          ...(step.mastery.event
            ? {
                event: {
                  question_id: step.mastery.event.questionId,
                  evidence: step.mastery.event.event.evidence,
                  score_before: step.mastery.event.event.scoreBefore,
                  score_after: step.mastery.event.event.scoreAfter,
                  state_before: step.mastery.event.event.stateBefore,
                  state_after: step.mastery.event.event.stateAfter,
                  reason: step.mastery.event.event.reason,
                },
              }
            : {}),
        }
      : null,
  };
}

const UNIQUE_VIOLATION = "23505";
/** The tutor_commit function raises PT409 (HTTP 409) when the session or the mastery record has changed. */
const CONFLICT_CODES = new Set(["PT409", "40001"]);

export class SupabaseTutorStore implements TutorStore {
  constructor(private readonly service: SupabaseClient) {}

  async createSession(input: Parameters<TutorStore["createSession"]>[0]): Promise<SessionRow> {
    const { data, error } = await this.service
      .from("tutor_sessions")
      .insert({
        learner_id: input.learnerId,
        objective_id: input.objectiveId,
        phase: input.phase,
        state: input.state,
      })
      .select(SESSION_COLUMNS)
      .single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw new ActiveSessionExistsError();
      throw new Error(`Could not open the lesson: ${error.message}`);
    }
    return toSession(data);
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const { data, error } = await this.service
      .from("tutor_sessions")
      .select(SESSION_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(`Could not read the lesson: ${error.message}`);
    return data ? toSession(data) : null;
  }

  async findActiveSession(learnerId: string, objectiveId: string): Promise<SessionRow | null> {
    const { data, error } = await this.service
      .from("tutor_sessions")
      .select(SESSION_COLUMNS)
      .eq("learner_id", learnerId)
      .eq("objective_id", objectiveId)
      .eq("status", "ACTIVE")
      .maybeSingle();
    if (error) throw new Error(`Could not look for an open lesson: ${error.message}`);
    return data ? toSession(data) : null;
  }

  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    const { data, error } = await this.service
      .from("tutor_messages")
      .select(MESSAGE_COLUMNS)
      .eq("session_id", sessionId)
      .order("seq", { ascending: true })
      .limit(1000);
    if (error) throw new Error(`Could not read the conversation: ${error.message}`);
    return (data ?? []).map((raw) => {
      const row = messageRowSchema.parse(raw);
      return {
        id: row.id,
        seq: row.seq,
        role: row.role,
        kind: row.kind,
        content: row.content,
        questionId: row.question_id,
        flagged: row.flagged,
        meta: row.meta as MessageMeta,
        createdAt: row.created_at,
      };
    });
  }

  async getMastery(learnerId: string, objectiveId: string) {
    const { data, error } = await this.service
      .from("learner_objective_mastery")
      .select(MASTERY_COLUMNS)
      .eq("learner_id", learnerId)
      .eq("objective_id", objectiveId)
      .maybeSingle();
    if (error) throw new Error(`Could not read mastery: ${error.message}`);
    if (!data) return null;
    const row = masteryRowSchema.parse(data);
    return { record: fromRow(row), version: row.updated_at };
  }

  async commit(step: StepCommit): Promise<number> {
    const { data, error } = await this.service.rpc("tutor_commit", commitParams(step));
    if (error) {
      if (CONFLICT_CODES.has(error.code)) throw new StepConflictError();
      throw new Error(`Could not save the lesson step: ${error.message}`);
    }
    if (typeof data !== "number") throw new Error("The lesson step returned no revision.");
    return data;
  }
}
