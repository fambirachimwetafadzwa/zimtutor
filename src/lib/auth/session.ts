import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EnvError } from "@/lib/env";
import { APP_ROLES, homePathForRole, type AppRole } from "@/lib/auth/roles";

export interface CurrentUser {
  id: string;
  role: AppRole;
  displayName: string;
}

export interface LearnerProfile {
  grade: number;
  username: string;
  avatar: string | null;
  onboardingCompleted: boolean;
}

const profileRow = z.object({
  id: z.uuid(),
  role: z.enum(APP_ROLES),
  display_name: z.string(),
  is_active: z.boolean(),
});

const learnerRow = z.object({
  grade: z.number().int().min(3).max(7),
  username: z.string(),
  avatar: z.string().nullable(),
  onboarding_completed: z.boolean(),
});

/**
 * The signed-in user, or null. Uses getUser(), which asks the Auth server to validate the session
 * (so a revoked session stops working immediately) — the right call for authorisation decisions.
 * Memoised per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (error instanceof EnvError) return null; // not configured: nobody can be signed in
    throw error;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: row } = await supabase
    .from("profiles")
    .select("id, role, display_name, is_active")
    .eq("id", data.user.id)
    .maybeSingle();
  const profile = profileRow.safeParse(row);
  if (!profile.success || !profile.data.is_active) return null;
  return { id: profile.data.id, role: profile.data.role, displayName: profile.data.display_name };
});

export async function requireUser(nextPath?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  }
  return user;
}

/** Require a signed-in user with exactly this role; anyone else is sent to where they belong. */
export async function requireRole(role: AppRole, nextPath?: string): Promise<CurrentUser> {
  const user = await requireUser(nextPath);
  if (user.role !== role) redirect(homePathForRole(user.role));
  return user;
}

export async function getLearnerProfile(learnerId: string): Promise<LearnerProfile | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("learner_profiles")
    .select("grade, username, avatar, onboarding_completed")
    .eq("profile_id", learnerId)
    .maybeSingle();
  const parsed = learnerRow.safeParse(data);
  if (!parsed.success) return null;
  return {
    grade: parsed.data.grade,
    username: parsed.data.username,
    avatar: parsed.data.avatar,
    onboardingCompleted: parsed.data.onboarding_completed,
  };
}
