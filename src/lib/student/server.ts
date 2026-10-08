import "server-only";
import { cachedPath } from "../adaptive/cache";
import { getLearnerPlan } from "../adaptive/service";
import { createSupabaseServerClient } from "../supabase/server";
import { sessionSummarySchema } from "../tutor/state";
import {
  buildDashboard,
  buildProgressScreen,
  type Dashboard,
  type ProgressScreen,
  type SessionRow,
} from "./dashboard";

/**
 * Reads for the student's own screens. Every query goes through the learner's OWN session (row-level
 * security shows them their records and nobody else's), never the service key.
 */

async function readLearner(learnerId: string) {
  const db = await createSupabaseServerClient();
  const path = await cachedPath(db);
  const learner = await getLearnerPlan(db, { learnerId, path, queueLength: 8 });
  return { db, path, learner };
}

async function readSessions(
  db: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  learnerId: string,
): Promise<SessionRow[]> {
  const { data, error } = await db
    .from("tutor_sessions")
    .select("id, objective_id, status, last_activity_at, ended_at, summary")
    .eq("learner_id", learnerId)
    .order("last_activity_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(`Could not read lessons: ${error.message}`);
  return (data ?? []).map((row) => {
    const summary = sessionSummarySchema.safeParse(row.summary);
    return {
      id: row.id as string,
      objectiveId: row.objective_id as string,
      status: row.status as SessionRow["status"],
      lastActivityAt: row.last_activity_at as string,
      endedAt: (row.ended_at as string | null) ?? null,
      summary: summary.success ? summary.data : null,
    };
  });
}

export async function loadDashboard(learnerId: string, now: Date = new Date()): Promise<Dashboard> {
  const { db, path, learner } = await readLearner(learnerId);
  const sessions = await readSessions(db, learnerId);
  return buildDashboard({ learner, path, sessions, now });
}

export async function loadProgressScreen(learnerId: string): Promise<ProgressScreen> {
  const { path, learner } = await readLearner(learnerId);
  return buildProgressScreen({ learner, path });
}
