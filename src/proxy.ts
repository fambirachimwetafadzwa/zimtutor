import type { NextRequest } from "next/server";
import { redirectKeepingSession, updateSession } from "@/lib/supabase/proxy-client";
import { roleForPath } from "@/lib/auth/roles";

/**
 * Runs before every page request (Next.js 16 "proxy", formerly "middleware").
 *
 *  1. keeps the Supabase session fresh (required by @supabase/ssr);
 *  2. sends signed-out visitors away from role areas (/student, /parent, /admin).
 *
 * It deliberately does NOT decide *which* role may enter an area: that needs a database lookup and
 * is enforced in the area's layout (requireRole), next to the data it protects.
 */
export async function proxy(request: NextRequest) {
  const session = await updateSession(request);
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
