import type { Sql } from "postgres";
import { toVectorLiteral } from "../../src/lib/ai/embeddings";
import { fromRow, masteryRowSchema } from "../../src/lib/mastery/service";
import type { BankStore } from "../../src/lib/questions/bank";
import {
  KEY_COLUMNS,
  QUESTION_COLUMNS,
  storedKeySchema,
  storedQuestionSchema,
  toBankInsert,
  type StoredKey,
  type StoredQuestion,
} from "../../src/lib/questions/bank-rows";
import type { VerifiedQuestion } from "../../src/lib/questions/generate";
import {
  ActiveSessionExistsError,
  StepConflictError,
  type SessionRow,
  type StepCommit,
  type StoredMessage,
  type TutorStore,
} from "../../src/lib/tutor/store";
import type { Passage, SearchFilter, SearchPort } from "../../src/lib/tutor/retrieval";
import { commitParams } from "../../src/lib/tutor/supabase-store";
import { sessionStateSchema, PHASES } from "../../src/lib/tutor/state";
import { z } from "zod";

/**
 * The tutor's and the question bank's stores against a real Postgres connection, using the same
 * database functions and tables as the Supabase stores. Rows are read as JSON (`to_jsonb`) so they
 * look exactly as PostgREST would deliver them.
 */

const sessionJson = z.object({
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

const toSession = (raw: unknown): SessionRow => {
  const r = sessionJson.parse(raw);
  return {
    id: r.id,
    learnerId: r.learner_id,
    objectiveId: r.objective_id,
    status: r.status,
    phase: r.phase,
    state: r.state,
    rev: r.rev,
    startedAt: r.started_at,
    lastActivityAt: r.last_activity_at,
    endedAt: r.ended_at,
  };
};

export class PostgresTutorStore implements TutorStore {
  constructor(private readonly sql: Sql) {}

  async createSession(input: Parameters<TutorStore["createSession"]>[0]): Promise<SessionRow> {
    try {
      const [row] = await this.sql`
        insert into public.tutor_sessions (learner_id, objective_id, phase, state)
        values (${input.learnerId}, ${input.objectiveId}, ${input.phase}, ${this.sql.json(input.state as never)})
        returning to_jsonb(tutor_sessions) as j`;
      return toSession(row!.j);
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new ActiveSessionExistsError();
      throw error;
    }
  }

  async getSession(id: string): Promise<SessionRow | null> {
    const [row] = await this
      .sql`select to_jsonb(s) as j from public.tutor_sessions s where id = ${id}`;
    return row ? toSession(row.j) : null;
  }

  async findActiveSession(learnerId: string, objectiveId: string): Promise<SessionRow | null> {
    const [row] = await this.sql`
      select to_jsonb(s) as j from public.tutor_sessions s
      where learner_id = ${learnerId} and objective_id = ${objectiveId} and status = 'ACTIVE'`;
    return row ? toSession(row.j) : null;
  }

  async listMessages(sessionId: string): Promise<StoredMessage[]> {
    const rows = await this.sql`
      select to_jsonb(m) as j from public.tutor_messages m where session_id = ${sessionId} order by seq`;
    return rows.map(({ j }) => ({
      id: j.id,
      seq: Number(j.seq),
      role: j.role,
      kind: j.kind,
      content: j.content,
      questionId: j.question_id,
      flagged: j.flagged,
      meta: j.meta,
      createdAt: j.created_at,
    }));
  }

  async getMastery(learnerId: string, objectiveId: string) {
    const [row] = await this.sql`
      select to_jsonb(m) as j from public.learner_objective_mastery m
      where learner_id = ${learnerId} and objective_id = ${objectiveId}`;
    if (!row) return null;
    const parsed = masteryRowSchema.parse(row.j);
    return { record: fromRow(parsed), version: parsed.updated_at };
  }

  async commit(step: StepCommit): Promise<number> {
    const p = commitParams(step);
    const json = (value: unknown) => (value === null ? null : this.sql.json(value as never));
    try {
      const [row] = await this.sql<Array<{ rev: number }>>`
        select public.tutor_commit(
          ${p.p_session_id}::uuid, ${p.p_expected_rev}::int, ${p.p_phase}, ${json(p.p_state)}::jsonb,
          ${p.p_status}, ${json(p.p_summary)}::jsonb, ${json(p.p_messages)}::jsonb,
          ${json(p.p_attempt)}::jsonb, ${json(p.p_mastery)}::jsonb
        ) as rev`;
      return row!.rev;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "PT409" || code === "40001") throw new StepConflictError();
      throw error;
    }
  }
}

export class PostgresBankStore implements BankStore {
  constructor(private readonly sql: Sql) {}

  async save(question: VerifiedQuestion): Promise<string> {
    const { question: q, key } = toBankInsert(question);
    const [row] = await this.sql<Array<{ id: string }>>`
      select public.bank_save_question(${this.sql.json(q as never)}, ${this.sql.json(key as never)}) as id`;
    return row!.id;
  }

  async recentQuestionIds(learnerId: string, objectiveId: string, limit: number) {
    const rows = await this.sql<Array<{ question_id: string }>>`
      select question_id from public.question_attempts
      where learner_id = ${learnerId} and objective_id = ${objectiveId}
      group by question_id order by max(created_at) desc limit ${limit}`;
    return rows.map((r) => r.question_id);
  }

  async candidates(
    objectiveId: string,
    difficulty: number,
    limit: number,
  ): Promise<StoredQuestion[]> {
    const rows = await this.sql.unsafe(
      `select ${QUESTION_COLUMNS} from public.questions
       where learning_objective_id = $1 and difficulty = $2 and status = 'ACTIVE'
         and verification_status <> 'REJECTED'
       order by created_at desc limit ${Number(limit)}`,
      [objectiveId, difficulty],
    );
    return rows.map((r) => storedQuestionSchema.parse(r));
  }

  async question(id: string): Promise<StoredQuestion | null> {
    const [row] = await this.sql.unsafe(
      `select ${QUESTION_COLUMNS} from public.questions where id = $1`,
      [id],
    );
    return row ? storedQuestionSchema.parse(row) : null;
  }

  async key(id: string): Promise<StoredKey | null> {
    const [row] = await this.sql.unsafe(
      `select ${KEY_COLUMNS} from public.question_keys where question_id = $1`,
      [id],
    );
    return row ? storedKeySchema.parse(row) : null;
  }
}

// ── syllabus search ─────────────────────────────────────────────────────────────────────────────

const toPassage = (row: Record<string, unknown>): Passage => ({
  id: String(row.chunk_key),
  objectiveId: (row.learning_objective_id as string | null) ?? null,
  section: String(row.section_type),
  text: String(row.content),
  page: (row.page as number | null) ?? null,
  pageEnd: (row.page_end as number | null) ?? null,
});

/** The retrieval functions of migration 0005, called over a direct connection. */
export class PostgresSearchPort implements SearchPort {
  constructor(private readonly sql: Sql) {}

  async text(query: string, filter: SearchFilter, limit: number): Promise<Passage[]> {
    const rows = await this.sql`
      select * from public.search_curriculum_chunks_text(
        ${query}, ${limit}, ${filter.grade}::smallint, 'mathematics', ${filter.topic})`;
    return rows.map(toPassage);
  }

  async vector(embedding: number[], filter: SearchFilter, limit: number): Promise<Passage[]> {
    const rows = await this.sql`
      select * from public.match_curriculum_chunks(
        ${toVectorLiteral(embedding)}::extensions.vector, ${limit}, ${filter.grade}::smallint,
        'mathematics', ${filter.topic})`;
    return rows.map(toPassage);
  }

  async forObjective(objectiveId: string): Promise<Passage | null> {
    const [row] = await this.sql`
      select * from public.curriculum_chunks
      where learning_objective_id = ${objectiveId} and section_type = 'COMPETENCY_OBJECTIVE'`;
    return row ? toPassage(row) : null;
  }
}
