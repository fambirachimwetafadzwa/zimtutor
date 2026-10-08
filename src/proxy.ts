import type { NextRequest } from "next/server";
import { redirectKeepingSession, updateSession } from "@/lib/supabase/proxy-client";
import { roleForPath } from "@/lib/auth/roles";
import { buildCsp, newNonce } from "@/lib/security/csp";

/**
 * Runs before every page request (Next.js 16 "proxy", formerly "middleware").
 *
 *  1. keeps the Supabase session fresh (required by @supabase/ssr);
 *  2. sends signed-out visitors away from role areas (/student, /parent, /admin);
 *  3. gives every page a Content Security Policy with a fresh nonce (see lib/security/csp.ts).
 *
 * It deliberately does NOT decide *which* role may enter an area: that needs a database lookup and
 * is enforced in the area's layout (requireRole), next to the data it protects.
 */
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = buildCsp({
    nonce,
    development: process.env.NODE_ENV === "development",
    upgradeInsecure: request.nextUrl.protocol === "https:",
  });
  // The page is rendered with the policy in the request (that is how Next.js finds the nonce and puts it
  // on its own scripts) and sent with it in the response.
  const session = await updateSession(request, {
    "Content-Security-Policy": csp,
    "x-nonce": nonce,
  });
  session.response.headers.set("Content-Security-Policy", csp);
  const { pathname, search } = request.nextUrl;

  if (roleForPath(pathname) !== null && !session.userId) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return redirectKeepingSession(login, session.response);
  }

  // (Signed-in visitors to /login are handled by the page itself: only the page can see whether the
  // profile is usable, and redirecting here could trap a deactivated account in a loop.)
  return session.response;
}

export const config = {
  // Skip static assets and image optimisation.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
