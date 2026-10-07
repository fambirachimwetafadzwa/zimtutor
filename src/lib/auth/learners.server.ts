import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PortError, type LearnerProvisioningPorts } from "@/lib/auth/learners";

/**
 * Supabase-backed implementation of the learner-provisioning ports.
 * Callers MUST have authenticated the parent first; `parentId` always comes from the session.
 */
export function createSupabaseProvisioningPorts(): LearnerProvisioningPorts {
  const admin = createSupabaseAdminClient();

  return {
    async createAuthUser({ email, password, displayName }) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        // Learners have no real inbox: mark confirmed so they can sign in immediately.
        email_confirm: true,
        user_metadata: { display_name: displayName },
        // app_metadata is writable only with the service role; the database trigger reads the role
        // from here, never from user_metadata (which users control themselves).
        app_metadata: { role: "student" },
      });
      if (error || !data.user) {
        if (error?.code === "email_exists" || error?.status === 422)
          throw new PortError("USER_EXISTS");
        throw error ?? new Error("createUser returned no user");
      }
      return { id: data.user.id };
    },

    async deleteAuthUser(id) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
    },

    async provisionProfile({ learnerId, parentId, grade, username, maxLearners }) {
      const { error } = await admin.rpc("provision_learner_profile", {
        p_learner: learnerId,
        p_parent: parentId,
        p_grade: grade,
        p_username: username,
        p_max_learners: maxLearners,
      });
      if (error) {
        if (error.code === "23505") throw new PortError("USERNAME_TAKEN");
        if (error.code === "ZT001") throw new PortError("LEARNER_LIMIT_REACHED");
        throw error;
      }
    },
  };
}
