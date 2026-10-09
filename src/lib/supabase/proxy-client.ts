import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { EnvError, readPublicEnv } from "@/lib/env";
import { sessionCookieOptions } from "./cookies";

export interface SessionUpdate {
  /** The response to return (carries any refreshed auth cookies and cache headers). */
  response: NextResponse;
  userId: string | null;
  /** False when Supabase is not configured (the site still serves public pages). */
  configured: boolean;
}

/**
 * Refresh the Supabase session for this request and report who (if anyone) is signed in.
 *
 * Two details matter for correctness and safety:
 *  - refreshed cookies must be written to BOTH the request (so server code in this same request
 *    sees them) and the response (so the browser stores them);
 *  - any response that sets auth cookies must not be cached by a CDN, or one user's session could
 *    be served to another — the library hands us the exact headers to apply.
 */
export async function updateSession(
  request: NextRequest,
  /** Headers the rendering of this request must see (the CSP and its nonce). */
  extraRequestHeaders: Record<string, string> = {},
): Promise<SessionUpdate> {
  // a response that passes the request on, with the extra headers and whatever cookies it now holds
  const next = () => {
    const headers = new Headers(request.headers);
    for (const [key, value] of Object.entries(extraRequestHeaders)) headers.set(key, value);
    return NextResponse.next({ request: { headers } });
  };
  let env;
  try {
    env = readPublicEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      return { response: next(), userId: null, configured: false };
    }
    throw error;
  }

  let response = next();
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions: sessionCookieOptions(env.siteUrl),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = next();
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Validates the JWT and refreshes it when needed. Must run before any response is produced.
  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  return { response, userId, configured: true };
}

/** A redirect that keeps the cookies/headers the session refresh produced. */
export function redirectKeepingSession(url: URL, session: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of session.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = session.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}
