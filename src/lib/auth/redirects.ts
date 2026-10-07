/**
 * Open-redirect protection. After sign-in we send people to a `next` path taken from the URL, so
 * it must be a same-site relative path and nothing else.
 */
const MAX_LENGTH = 300;

const FORBIDDEN = /[\u0000-\u001f\u007f\\]/;

export function safeRedirectPath(candidate: string | null | undefined, fallback = "/"): string {
  if (!candidate) return fallback;
  if (candidate.length > MAX_LENGTH) return fallback;
  if (FORBIDDEN.test(candidate)) return fallback;
  // Must be a path on this site: starts with exactly one "/" ("//host" is protocol-relative).
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  // Percent-encoded tricks like /%2F/evil.com or /%5Cevil.com.
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return fallback;
  }
  if (decoded.startsWith("//") || FORBIDDEN.test(decoded)) return fallback;
  // Resolve against a dummy origin and make sure we stay on it.
  try {
    const url = new URL(candidate, "https://zimtutor.invalid");
    if (url.origin !== "https://zimtutor.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
