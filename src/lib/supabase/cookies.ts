import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * How the sign-in session cookies are set.
 *
 *  - httpOnly: ZimTutor has no browser-side Supabase client, so no script on a page ever needs to
 *    read the session. Keeping it out of `document.cookie` means that even a script injected into a
 *    page could not take a child's or a parent's session with it.
 *  - sameSite lax: the session is not sent along with requests started by other sites.
 *  - secure: on a site served over https (a Secure cookie is not accepted by every browser on plain
 *    http, which is how local development runs).
 */
export function sessionCookieOptions(siteUrl: string): CookieOptionsWithName {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: siteUrl.startsWith("https://"),
    path: "/",
  };
}
