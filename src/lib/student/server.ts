import "server-only";
import { cachedPath } from "../adaptive/cache";
import { getLearnerPlan } from "../adaptive/service";
import { createSupabaseServerClient } from "../supabase/server";
import { readSessions } from "./sessions";
import {
  buildDashboard,
  buildProgressScreen,
  type Dashboard,
  type ProgressScreen,
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

export async function loadDashboard(learnerId: string, now: Date = new Date()): Promise<Dashboard> {
  const { db, path, learner } = await readLearner(learnerId);
  const sessions = await readSessions(db, learnerId);
  return buildDashboard({ learner, path, sessions, now });
}

export async function loadProgressScreen(learnerId: string): Promise<ProgressScreen> {
  const { path, learner } = await readLearner(learnerId);
  return buildProgressScreen({ learner, path });
}
