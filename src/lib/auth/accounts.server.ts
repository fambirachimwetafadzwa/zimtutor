import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AccountPorts } from "./accounts";

/**
 * The Supabase-backed ports for accounts.ts. Callers MUST have authenticated the parent first;
 * every rule about WHO may do what is in accounts.ts, and uses only what these report.
 */
export function createSupabaseAccountPorts(): AccountPorts {
  const admin = createSupabaseAdminClient();

  return {
    async isGuardian(parentId, learnerId) {
      const { data, error } = await admin
        .from("guardianships")
        .select("learner_id")
        .eq("parent_id", parentId)
        .eq("learner_id", learnerId)
        .maybeSingle();
      if (error) throw error;
      return data !== null;
    },

    async guardedLearners(parentId) {
      const { data: mine, error } = await admin
        .from("guardianships")
        .select("learner_id")
        .eq("parent_id", parentId);
      if (error) throw error;
      const ids = (mine ?? []).map((row) => row.learner_id as string);
      if (ids.length === 0) return [];
      const { data: everyone, error: allError } = await admin
        .from("guardianships")
        .select("learner_id")
        .in("learner_id", ids);
      if (allError) throw allError;
      const counts = new Map<string, number>();
      for (const row of everyone ?? [])
        counts.set(row.learner_id as string, (counts.get(row.learner_id as string) ?? 0) + 1);
      return ids.map((learnerId) => ({ learnerId, guardians: counts.get(learnerId) ?? 1 }));
    },

    async learnerUsername(learnerId) {
      const { data, error } = await admin
        .from("learner_profiles")
        .select("username")
        .eq("profile_id", learnerId)
        .maybeSingle();
      if (error) throw error;
      return (data?.username as string | undefined) ?? null;
    },

    async deleteAuthUser(id) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
    },

    async setPassword(id, password) {
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) throw error;
    },
  };
}
