import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "../../src/lib/security/csp";

const directive = (csp: string, name: string): string[] =>
  (csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "").split(" ").slice(1);

describe("the content security policy", () => {
  const nonce = newNonce();
  const csp = buildCsp({ nonce });

  it("lets scripts run only when they carry this request's nonce, never inline or from elsewhere", () => {
    const scripts = directive(csp, "script-src");
    expect(scripts).toContain(`'nonce-${nonce}'`);
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts.some((s) => s.startsWith("http") || s === "*")).toBe(false);
  });

  it("keeps everything on ZimTutor's own origin: connections, forms, base and frames", () => {
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "connect-src")).toEqual(["'self'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "media-src")).toEqual(["'none'"]);
    expect(csp).not.toMatch(/https?:\/\//);
  });

  it("allows style attributes (a bar's width) but no inline style elements or scripts", () => {
    expect(directive(csp, "style-src")).toEqual(["'self'", `'nonce-${nonce}'`]);
    expect(directive(csp, "style-src-attr")).toEqual(["'unsafe-inline'"]);
  });

  it("allows eval and inline styles only in development", () => {
    const dev = buildCsp({ nonce, development: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "style-src")).toContain("'unsafe-inline'");
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("asks for https only when the page itself came over https", () => {
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(buildCsp({ nonce, upgradeInsecure: true })).toContain("upgrade-insecure-requests");
  });

  it("refuses a nonce that could break out of the header", () => {
    for (const bad of [
      "",
      "short",
      "abc'; script-src *",
      "x".repeat(20) + " 'unsafe-inline'",
      "a b c d e f g h i j k l",
    ])
      expect(() => buildCsp({ nonce: bad })).toThrow();
  });

  it("makes a fresh unguessable nonce every time", () => {
    const nonces = new Set(Array.from({ length: 200 }, newNonce));
    expect(nonces.size).toBe(200);
    for (const n of nonces) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
