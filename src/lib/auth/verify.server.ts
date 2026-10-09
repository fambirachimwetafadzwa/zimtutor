import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readPublicEnv } from "@/lib/env";

/**
 * Check that someone knows a password, without signing them in anywhere: a throwaway client that
 * keeps no session and writes no cookie. Used before something that cannot be undone, so that a
 * session left open on a shared phone cannot do it alone.
 *
 * The caller counts the attempt against the sign-in limit first.
 */
export async function passwordIsRight(email: string, password: string): Promise<boolean> {
  const env = readPublicEnv();
  const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) return false;
  // the sign-in made a session of its own; end it so that nothing is left open
  await client.auth.signOut().catch(() => {});
  return true;
}
