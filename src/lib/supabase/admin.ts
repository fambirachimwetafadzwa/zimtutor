import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readPublicEnv, readServerEnv } from "@/lib/env";

/**
 * Service-role client. It BYPASSES row-level security.
 *
 * Use it only for operations the browser must never be able to perform itself — marking answers,
 * writing mastery, reading answer keys, provisioning learner accounts — and only AFTER the calling
 * code has authenticated the user and checked they may act on the data involved. Never pass a
 * learner/user id received from the client straight into a query made with this client.
 */
export function createSupabaseAdminClient() {
  const { supabaseUrl } = readPublicEnv();
  const { supabaseServiceRoleKey } = readServerEnv();
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
