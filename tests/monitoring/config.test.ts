import { describe, expect, it } from "vitest";
import { reportersFromEnv } from "../../src/lib/monitoring/config";
import type { Send } from "../../src/lib/monitoring/reporters";

const send: Send = async () => ({ ok: true, status: 200 });
const names = (env: Record<string, string>) =>
  reportersFromEnv(env, send).reporters.map((r) => r.name);

describe("which services to report to", () => {
  it("is none, unless somebody turned one on", () => {
    expect(reportersFromEnv({}, send)).toEqual({ reporters: [], problems: [] });
    expect(reportersFromEnv({ NODE_ENV: "production", VERCEL: "1" }, send).reporters).toEqual([]);
    expect(reportersFromEnv({ SENTRY_DSN: "  ", POSTHOG_KEY: "" }, send).reporters).toEqual([]);
  });

  it("is Sentry when there is a Sentry address", () => {
    expect(names({ SENTRY_DSN: "https://k@o1.ingest.sentry.io/12" })).toEqual(["sentry"]);
  });

  it("is PostHog only when it has both its key and an https host", () => {
    expect(names({ POSTHOG_KEY: "phc_x", POSTHOG_HOST: "https://eu.i.posthog.com" })).toEqual([
      "posthog",
    ]);
    expect(reportersFromEnv({ POSTHOG_KEY: "phc_x" }, send).problems).toHaveLength(1);
    expect(
      reportersFromEnv({ POSTHOG_HOST: "https://eu.i.posthog.com" }, send).problems,
    ).toHaveLength(1);
    expect(names({ POSTHOG_KEY: "phc_x", POSTHOG_HOST: "http://insecure.example.test" })).toEqual(
      [],
    );
    expect(
      reportersFromEnv({ POSTHOG_KEY: "phc_x", POSTHOG_HOST: "http://insecure.example.test" }, send)
        .problems,
    ).toHaveLength(1);
  });

  it("can be both", () => {
    expect(
      names({
        SENTRY_DSN: "https://k@o1.ingest.sentry.io/12",
        POSTHOG_KEY: "phc_x",
        POSTHOG_HOST: "https://eu.i.posthog.com",
      }),
    ).toEqual(["sentry", "posthog"]);
  });

  it("says so, rather than silently reporting nowhere, when the address is wrong", () => {
    const result = reportersFromEnv({ SENTRY_DSN: "https://nonsense" }, send);
    expect(result.reporters).toEqual([]);
    expect(result.problems[0]).toContain("SENTRY_DSN");
    // and the problem does not repeat what was configured
    expect(result.problems[0]).not.toContain("nonsense");
  });
});
