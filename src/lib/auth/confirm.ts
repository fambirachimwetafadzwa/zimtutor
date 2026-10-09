import { safeRedirectPath } from "./redirects";

/**
 * The link in an email from the sign-in service: `/auth/confirm?token_hash=…&type=recovery&next=…`.
 * It carries a one-time token that proves the person can read that mailbox, so it works from any
 * browser or device (a link that needs the browser that asked for it fails when the email is opened in
 * another app, which on a phone is the usual case).
 *
 * Only the kinds of link ZimTutor sends are accepted, and `next` is a path on this site and nothing else.
 */
export const CONFIRM_TYPES = ["recovery", "signup", "email"] as const;
export type ConfirmType = (typeof CONFIRM_TYPES)[number];

export interface ConfirmLink {
  tokenHash: string;
  type: ConfirmType;
  next: string;
}

export function parseConfirmLink(params: { get(name: string): string | null }): ConfirmLink | null {
  const tokenHash = params.get("token_hash") ?? "";
  const type = params.get("type") ?? "";
  // a token is a long run of letters, digits and a few separators: nothing else is passed on
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(tokenHash)) return null;
  if (!(CONFIRM_TYPES as readonly string[]).includes(type)) return null;
  const fallback = type === "recovery" ? "/reset-password" : "/";
  return {
    tokenHash,
    type: type as ConfirmType,
    next: safeRedirectPath(params.get("next"), fallback),
  };
}
