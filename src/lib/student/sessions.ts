import type { SupabaseClient } from "@supabase/supabase-js";
import { sessionSummarySchema } from "../tutor/state";
import type { SessionRow } from "./dashboard";

/**
 * A learner's lessons as the screens use them: when each ended and how it went. Read through the
 * caller's own session, so row-level security decides whose lessons are visible (the learner's own,
 * or their guardian's). Only the end-of-lesson summary is read from a lesson, never its messages.
 */
export async function readSessions(db: SupabaseClient, learnerId: string): Promise<SessionRow[]> {
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
