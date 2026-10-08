import "server-only";
import { cachedPath } from "../adaptive/cache";
import { getMastery } from "../mastery/service";
import { readSessions } from "../student/sessions";
import { createSupabaseServerClient } from "../supabase/server";
import { buildParentOverview, type ParentOverview } from "./overview";

/**
 * Reads for a parent's view of a child. Every query goes through the PARENT's own session: row-level
 * security shows a guardian their own children's progress, and nobody else's. The conversation tables
 * are not read here at all (and a guardian could not read them if they tried).
 */
export async function loadParentOverview(
  learnerId: string,
  now: Date = new Date(),
): Promise<ParentOverview | null> {
  const db = await createSupabaseServerClient();
  const { data: profile } = await db
    .from("learner_profiles")
    .select("grade, username")
    .eq("profile_id", learnerId)
    .maybeSingle();
  if (!profile) return null; // not this parent's child, or no such child

  const [{ data: person }, path, mastery, sessions] = await Promise.all([
    db.from("profiles").select("display_name").eq("id", learnerId).maybeSingle(),
    cachedPath(db),
    getMastery(db, learnerId),
    readSessions(db, learnerId),
  ]);
  return buildParentOverview({
    learner: {
      name: (person?.display_name as string | undefined) ?? "Learner",
      grade: profile.grade as number,
      username: profile.username as string,
    },
    path,
    mastery,
    sessions,
    now,
  });
}
