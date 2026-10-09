import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the browser is sent (the files under .next/static after `next build`) must hold no secret and
 * no server-only code. Skipped when there is no build to look at; CI builds first.
 */

const STATIC = path.resolve(".next/static");
const built = fs.existsSync(STATIC);

function files(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

describe.skipIf(!built)("the files sent to browsers", () => {
  const all = built ? files(STATIC).filter((f) => /\.(js|css|json|html|txt)$/.test(f)) : [];
  const text = built
    ? all.map((f) => ({ file: path.relative(STATIC, f), body: fs.readFileSync(f, "utf8") }))
    : [];

  it("are there to be looked at", () => {
    expect(text.length).toBeGreaterThan(5);
  });

  it("hold none of this deployment's secrets", () => {
    const names = [
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SECRET_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_COMPATIBLE_API_KEY",
      "EMBEDDING_API_KEY",
      "RATE_LIMIT_SECRET",
      "POSTHOG_KEY",
      "SENTRY_DSN",
    ];
    for (const name of names) {
      const value = process.env[name];
      if (!value || value.length < 12) continue;
      for (const { file, body } of text)
        expect(body.includes(value), `${name} is in ${file}`).toBe(false);
    }
    const url = process.env.DATABASE_URL;
    if (url)
      for (const { file, body } of text)
        expect(body.includes(url), `DATABASE_URL is in ${file}`).toBe(false);
  });

  it("hold no service-role token, whatever it is called", () => {
    const token = /eyJ[A-Za-z0-9_-]{6,}\.([A-Za-z0-9_-]{6,})\.[A-Za-z0-9_-]*/g;
    for (const { file, body } of text) {
      for (const match of body.matchAll(token)) {
        let payload = "";
        try {
          payload = Buffer.from(match[1]!, "base64url").toString("utf8");
        } catch {
          continue;
        }
        expect(payload, `a token in ${file}`).not.toMatch(/service_role/);
      }
    }
  });

  it("hold no provider key", () => {
    for (const { file, body } of text) {
      expect(body, file).not.toMatch(/sk-ant-[A-Za-z0-9_-]{10,}/);
      expect(body, file).not.toMatch(/\bsk-[A-Za-z0-9]{32,}/);
      expect(body, file).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/);
      expect(body, file).not.toMatch(/phx_[A-Za-z0-9]{20,}/);
    }
  });

  it("hold no server-only code: the names of secrets, the answer keys' table, the service client", () => {
    for (const { file, body } of text) {
      for (const name of [
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SECRET_KEY",
        "ANTHROPIC_API_KEY",
        "question_keys",
        "rate_limit_hit",
        "tutor_commit",
        "exam_start",
      ])
        expect(body.includes(name), `${name} is in ${file}`).toBe(false);
    }
  });
});
