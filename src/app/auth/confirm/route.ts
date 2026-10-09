import { NextResponse, type NextRequest } from "next/server";
import { parseConfirmLink } from "@/lib/auth/confirm";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where the link in an email from the sign-in service lands (a new password, a confirmed address).
 * The one-time token is exchanged for a session, and the person is sent on to a page on this site.
 * A link that is wrong, old or already used sends them to sign in with a message, never to an error.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const link = parseConfirmLink(searchParams);
  if (link) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({
      type: link.type,
      token_hash: link.tokenHash,
    });
    if (!error) return NextResponse.redirect(new URL(link.next, origin));
  }
  return NextResponse.redirect(new URL("/login?who=parent&error=link", origin));
}
