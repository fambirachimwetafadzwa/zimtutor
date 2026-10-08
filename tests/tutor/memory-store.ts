import { randomUUID } from "node:crypto";
import type { MasteryEvent, MasteryRecord } from "../../src/lib/mastery/engine";
import {
  ActiveSessionExistsError,
  StepConflictError,
  type NewAttempt,
  type SessionRow,
  type StepCommit,
  type StoredMessage,
  type TutorStore,
} from "../../src/lib/tutor/store";
import { sessionStateSchema, type Phase, type SessionState } from "../../src/lib/tutor/state";
import type { MemoryBankStore } from "../questions/memory-store";

/**
 * The tutor's storage held in memory, behaving like the database function `tutor_commit`: a step
 * commits only against the revision it read, mastery only against the version it read, and a step
 * either applies completely or not at all.
 */
export class MemoryTutorStore implements TutorStore {
  readonly sessions = new Map<string, SessionRow>();
  readonly messages = new Map<string, StoredMessage[]>();
  readonly attempts: Array<NewAttempt & { learnerId: string; sessionId: string }> = [];
  readonly mastery = new Map<string, { record: MasteryRecord; version: number }>();
  readonly events: Array<{ objectiveId: string; questionId: string | null; event: MasteryEvent }> =
    [];
  readonly summaries = new Map<string, unknown>();
  commits = 0;
  private seq = 0;

  /** Runs just before a commit is checked: tests use it to play another request that got there first. */
  beforeCommit: ((step: StepCommit) => void | Promise<void>) | undefined;

  constructor(
    private readonly bank: MemoryBankStore | undefined = undefined,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async createSession(input: {
    learnerId: string;
    objectiveId: string;
    phase: Phase;
    state: SessionState;
  }): Promise<SessionRow> {
    for (const s of this.sessions.values())
      if (
        s.learnerId === input.learnerId &&
        s.objectiveId === input.objectiveId &&
        s.status === "ACTIVE"
      )
        throw new ActiveSessionExistsError();
    const at = this.clock().toISOString();
    const row: SessionRow = {
      id: randomUUID(),
      learnerId: input.learnerId,
      objectiveId: input.objectiveId,
      status: "ACTIVE",
      phase: input.phase,
      state: structuredClone(input.state),
      rev: 0,
      startedAt: at,
      lastActivityAt: at,
      endedAt: null,
    };
    this.sessions.set(row.id, row);
    this.messages.set(row.id, []);
    return structuredClone(row);
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const row = this.sessions.get(id);
    return row ? structuredClone(row) : null;
  }

  async findActiveSession(learnerId: string, objectiveId: string): Promise<SessionRow | null> {
    for (const s of this.sessions.values())
      if (s.learnerId === learnerId && s.objectiveId === objectiveId && s.status === "ACTIVE")
        return structuredClone(s);
    return null;
  }

  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    return structuredClone(this.messages.get(sessionId) ?? []);
  }

  async getMastery(learnerId: string, objectiveId: string) {
    const found = this.mastery.get(`${learnerId}|${objectiveId}`);
    return found ? { record: structuredClone(found.record), version: String(found.version) } : null;
  }

  /** Put a mastery record in place (a learner who has already worked on a goal). */
  seedMastery(learnerId: string, objectiveId: string, record: MasteryRecord): void {
    this.mastery.set(`${learnerId}|${objectiveId}`, {
      record: structuredClone(record),
      version: 1,
    });
  }

  async commit(step: StepCommit): Promise<number> {
    await this.beforeCommit?.(step);
    this.commits++;
    const session = this.sessions.get(step.sessionId);
    if (!session) throw new Error(`unknown tutor session ${step.sessionId}`);
    if (session.rev !== step.expectedRev) throw new StepConflictError();

    // validate everything first: a step applies completely or not at all
    const masteryKey = step.mastery ? `${session.learnerId}|${step.mastery.objectiveId}` : null;
    if (step.mastery && masteryKey) {
      const current = this.mastery.get(masteryKey);
      const expected = step.mastery.expectedVersion;
      if (expected === null ? current !== undefined : String(current?.version) !== expected)
        throw new StepConflictError();
    }
    if (step.attempt) {
      const duplicate = this.attempts.some(
        (a) =>
          a.sessionId === step.sessionId &&
          a.questionId === step.attempt!.questionId &&
          a.attemptNumber === step.attempt!.attemptNumber,
      );
      if (duplicate) throw new Error("duplicate key value violates unique constraint (attempt)");
    }
    sessionStateSchema.parse(step.state); // the database would hold exactly what the schema allows

    // apply
    session.phase = step.phase;
    session.state = structuredClone(step.state);
    session.status = step.status;
    session.lastActivityAt = this.clock().toISOString();
    session.endedAt =
      step.status === "ACTIVE" ? null : (session.endedAt ?? this.clock().toISOString());
    session.rev += 1;
    if (step.summary) this.summaries.set(step.sessionId, structuredClone(step.summary));
    const list = this.messages.get(step.sessionId) ?? [];
    for (const m of step.messages) {
      this.seq += 1;
      list.push({
        id: randomUUID(),
        seq: this.seq,
        role: m.role,
        kind: m.kind,
        content: m.content,
        questionId: m.questionId ?? null,
        flagged: m.flagged ?? false,
        meta: structuredClone(m.meta ?? {}),
        createdAt: this.clock().toISOString(),
      });
    }
    this.messages.set(step.sessionId, list);
    if (step.attempt) {
      this.attempts.push({
        ...structuredClone(step.attempt),
        learnerId: session.learnerId,
        sessionId: step.sessionId,
      });
      this.bank?.attempt(session.learnerId, step.attempt.objectiveId, step.attempt.questionId);
    }
    if (step.mastery && masteryKey) {
      const current = this.mastery.get(masteryKey);
      this.mastery.set(masteryKey, {
        record: structuredClone(step.mastery.record),
        version: (current?.version ?? 0) + 1,
      });
      if (step.mastery.event)
        this.events.push({
          objectiveId: step.mastery.objectiveId,
          questionId: step.mastery.event.questionId,
          event: structuredClone(step.mastery.event.event),
        });
    }
    return session.rev;
  }

  /** Every message of a learner's sessions, oldest first (for assertions). */
  allMessages(sessionId: string): StoredMessage[] {
    return this.messages.get(sessionId) ?? [];
  }
}
