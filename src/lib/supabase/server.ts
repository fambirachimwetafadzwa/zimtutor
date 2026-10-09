import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { readPublicEnv } from "@/lib/env";
import { sessionCookieOptions } from "./cookies";

/**
 * Supabase client bound to the signed-in user's session cookies. Every query it makes is subject
 * to row-level security as that user. Create one per request; never share across requests.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = readPublicEnv();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions: sessionCookieOptions(env.siteUrl),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet)
            cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes
          // sessions on every request, so ignoring this is safe.
        }
      },
    },
  });
}
