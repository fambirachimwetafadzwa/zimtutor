import type { SupabaseClient } from "@supabase/supabase-js";
import { getMastery } from "../mastery/service";
import { loadPath, type Path } from "./path";
import { practicableObjectiveIds } from "./practice";
import { summariseProgress, type ProgressSummary } from "./progress";
import { recommend, type Plan } from "./recommend";

/**
 * A learner's plan and progress, read from the database. `db` may be the learner's own client (row-
 * level security shows them their own records), a parent's (their children's) or the server's.
 * The syllabus path is the same for everyone, so callers pass one in and reuse it; `loadPath` reads it.
 */

export interface LearnerPlan {
  grade: number;
  plan: Plan;
  progress: ProgressSummary;
}

export async function getLearnerGrade(db: SupabaseClient, learnerId: string): Promise<number> {
  const { data, error } = await db
    .from("learner_profiles")
    .select("grade")
    .eq("profile_id", learnerId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the learner: ${error.message}`);
  if (!data) throw new Error("No learner with that id is visible to this account");
  return data.grade as number;
}

export async function getLearnerPlan(
  db: SupabaseClient,
  input: { learnerId: string; path?: Path; now?: Date; queueLength?: number },
): Promise<LearnerPlan> {
  const now = input.now ?? new Date();
  const [grade, path, mastery] = await Promise.all([
    getLearnerGrade(db, input.learnerId),
    input.path ?? loadPath(db),
    getMastery(db, input.learnerId),
  ]);
  const practicable = practicableObjectiveIds(path);
  const isPracticable = (id: string) => practicable.has(id);
  return {
    grade,
    plan: recommend({
      path,
      grade,
      mastery,
      now,
      practicable: isPracticable,
      ...(input.queueLength ? { limit: input.queueLength } : {}),
    }),
    progress: summariseProgress({ path, grade, mastery, now, include: isPracticable }),
  };
}
