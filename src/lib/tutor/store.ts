import type { LearnerAnswer, MarkingMethod } from "../marking/spec";
import type { MasteryEvent, MasteryRecord } from "../mastery/engine";
import type { Phase, SessionState, SessionSummary } from "./state";

/**
 * What the tutor needs from storage. The tutor service talks to this interface, so the whole lesson
 * flow can be tested in memory; the real implementation (supabase-store.ts) writes every step in ONE
 * database transaction, guarded by a revision number.
 */

export type SessionStatus = "ACTIVE" | "COMPLETED" | "ABANDONED";

export interface SessionRow {
  id: string;
  learnerId: string;
  objectiveId: string;
  status: SessionStatus;
  phase: Phase;
  state: SessionState;
  /** Changes with every committed step. */
  rev: number;
  startedAt: string;
  lastActivityAt: string;
  endedAt: string | null;
}

/** A syllabus quotation shown with a message. Always verbatim, always labelled as the syllabus's own. */
export interface Quote {
  label: string;
  items: string[];
}

/** What is kept about a message besides its words. No personal data. */
export interface MessageMeta {
  /** Where the words came from. */
  source?: "template" | "model";
  model?: { provider: string; name: string };
  /** Why template text was used although a model was configured. */
  fallback?: string[];
  quotes?: Quote[];
  /** e.g. "Revised Junior Mathematics Syllabus 2024-2030 (MoPSE), page 34" */
  citation?: string;
  hint?: { number: number; of: number; exhausted?: boolean };
  verdict?: string;
  attempt?: number;
  decision?: string;
  /** Safety-screen categories that produced a SAFETY message or flagged a learner message. */
  screen?: string[];
}

export type MessageRole = "tutor" | "learner" | "system";

export interface NewMessage {
  role: MessageRole;
  kind: string;
  content: string;
  questionId?: string | null;
  flagged?: boolean;
  meta?: MessageMeta;
}

export interface StoredMessage {
  id: string;
  seq: number;
  role: MessageRole;
  kind: string;
  content: string;
  questionId: string | null;
  flagged: boolean;
  meta: MessageMeta;
  createdAt: string;
}

export interface NewAttempt {
  questionId: string;
  objectiveId: string;
  attemptNumber: number;
  answer: LearnerAnswer;
  isCorrect: boolean;
  score: number;
  hintsUsed: number;
  markingMethod: MarkingMethod;
  /** The marker's trace. It never contains the expected answer. */
  markingDetail: Record<string, unknown>;
  misconceptionTags: string[];
  timeTakenMs: number | null;
  difficulty: number | null;
}

export interface MasteryCommit {
  objectiveId: string;
  /** The version (`updated_at`) the record was read with; null when there was no record. */
  expectedVersion: string | null;
  record: MasteryRecord;
  event?: { questionId: string | null; event: MasteryEvent };
}

/** Everything one step of a lesson changes, written together or not at all. */
export interface StepCommit {
  sessionId: string;
  expectedRev: number;
  phase: Phase;
  state: SessionState;
  status: SessionStatus;
  summary?: SessionSummary;
  messages: NewMessage[];
  attempt?: NewAttempt;
  mastery?: MasteryCommit;
}

/** Someone else changed the session (or the learner's mastery record) first. Read again and retry. */
export class StepConflictError extends Error {
  constructor() {
    super("The tutor session changed while this step was being worked out.");
    this.name = "StepConflictError";
  }
}

/** The learner already has an active session for this objective. */
export class ActiveSessionExistsError extends Error {
  constructor() {
    super("There is already an active session for this goal.");
    this.name = "ActiveSessionExistsError";
  }
}

export interface TutorStore {
  /** Open a session. Throws ActiveSessionExistsError when one is already active for the goal. */
  createSession(input: {
    learnerId: string;
    objectiveId: string;
    phase: Phase;
    state: SessionState;
  }): Promise<SessionRow>;
  getSession(id: string): Promise<SessionRow | null>;
  findActiveSession(learnerId: string, objectiveId: string): Promise<SessionRow | null>;
  /** Oldest first. */
  listMessages(sessionId: string): Promise<StoredMessage[]>;
  getMastery(
    learnerId: string,
    objectiveId: string,
  ): Promise<{ record: MasteryRecord; version: string } | null>;
  /** Apply one step atomically. Returns the session's new revision. Throws StepConflictError. */
  commit(step: StepCommit): Promise<number>;
}
