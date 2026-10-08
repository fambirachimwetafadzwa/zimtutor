/**
 * The Content Security Policy sent with every page (Next.js guide: "Content Security Policy", with a
 * nonce made fresh for every request by proxy.ts).
 *
 * What it does for a children's product: scripts run only when this server put them in the page (a
 * script an attacker slips into a page has no nonce and does not run), nothing can load from or send to
 * another site (all connections are to ZimTutor itself), nobody can frame the pages, and forms can only
 * post back to ZimTutor.
 *
 * `style-src-attr 'unsafe-inline'` is deliberate and small: progress bars and pictures use inline style
 * attributes, and a style attribute cannot run code.
 */

export interface CspOptions {
  /** A fresh unguessable value for this request. */
  nonce: string;
  /** Development needs `eval` for React's debugging; production never does. */
  development?: boolean;
  /** Ask browsers to use https for anything the page loads (only when the page itself came over https). */
  upgradeInsecure?: boolean;
}

export function buildCsp({
  nonce,
  development = false,
  upgradeInsecure = false,
}: CspOptions): string {
  if (!/^[A-Za-z0-9+/=_-]{16,}$/.test(nonce))
    throw new Error("The CSP nonce is not a usable value");
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-inline'" : ""}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (upgradeInsecure) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** A fresh nonce: 128 random bits, base64. (Web Crypto: works in the proxy's runtime.) */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
