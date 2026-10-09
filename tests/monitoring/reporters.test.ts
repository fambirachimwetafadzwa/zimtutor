import { describe, expect, it } from "vitest";
import {
  parseSentryDsn,
  PostHogReporter,
  ReporterFailure,
  SentryReporter,
  sentryEnvelope,
  sentryEvent,
  sentryFrame,
  type ErrorReport,
  type Send,
} from "../../src/lib/monitoring/reporters";

const AT = new Date("2026-10-08T12:00:00.000Z");

const report: ErrorReport = {
  event: "tutor_action_failed",
  error: {
    name: "TypeError",
    message: "no row for [email]",
    code: "PT409",
    frames: [
      "at inner (/app/src/a.ts:10:5)",
      "at outer (/app/node_modules/x/b.js:20:7)",
      "at /app/src/c.ts:30:9",
    ],
  },
  fields: { bucket: "tutor.ask", status: 500, retry: true },
  at: AT,
};

function recorder(answer: { ok: boolean; status: number } | Error = { ok: true, status: 200 }) {
  const calls: Array<{
    url: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }> = [];
  const send: Send = async (url, init) => {
    calls.push({ url, ...init });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, send };
}

describe("a Sentry address", () => {
  it("gives the place to send envelopes and the key", () => {
    expect(parseSentryDsn("https://abc123@o42.ingest.sentry.io/4507")).toEqual({
      url: "https://o42.ingest.sentry.io/api/4507/envelope/",
      publicKey: "abc123",
      dsn: "https://o42.ingest.sentry.io/4507",
    });
    expect(parseSentryDsn("http://k@localhost:9000/1")?.url).toBe(
      "http://localhost:9000/api/1/envelope/",
    );
  });

  it("is nothing when it is not one", () => {
    for (const bad of [
      "",
      "not a url",
      "https://o42.ingest.sentry.io/4507",
      "https://k@host/notanumber",
      "ftp://k@host/1",
      "https://k@host/",
    ])
      expect(parseSentryDsn(bad), bad).toBeNull();
  });
});

describe("a stack frame as Sentry wants it", () => {
  it("reads a named frame and an anonymous one", () => {
    expect(sentryFrame("at inner (/app/src/a.ts:10:5)")).toEqual({
      function: "inner",
      filename: "/app/src/a.ts",
      lineno: 10,
      colno: 5,
      in_app: true,
    });
    expect(sentryFrame("at /app/node_modules/x/b.js:20:7")).toEqual({
      filename: "/app/node_modules/x/b.js",
      lineno: 20,
      colno: 7,
      in_app: false,
    });
    expect(sentryFrame("at something odd")).toEqual({ filename: "something odd" });
  });
});

describe("a Sentry event", () => {
  const event = sentryEvent(report, { environment: "production", release: "abc" }, "e".repeat(32));

  it("says what happened and where, with the oldest call first", () => {
    expect(event).toMatchObject({
      event_id: "e".repeat(32),
      timestamp: AT.getTime() / 1000,
      platform: "node",
      level: "error",
      logger: "tutor_action_failed",
      environment: "production",
      release: "abc",
    });
    expect(event.exception.values[0]).toMatchObject({
      type: "TypeError",
      value: "no row for [email]",
    });
    const frames = event.exception.values[0]!.stacktrace.frames;
    expect(frames.map((f) => ("function" in f ? f.function : "anonymous"))).toEqual([
      "anonymous",
      "outer",
      "inner",
    ]);
  });

  it("carries the listed facts as tags, as text, and the code", () => {
    expect(event.tags).toEqual({
      event: "tutor_action_failed",
      code: "PT409",
      bucket: "tutor.ask",
      status: "500",
      retry: "true",
    });
  });

  it("names no person, no request, no address and no machine", () => {
    for (const key of [
      "user",
      "request",
      "contexts",
      "server_name",
      "breadcrumbs",
      "extra",
      "modules",
      "message",
    ])
      expect(event, key).not.toHaveProperty(key);
  });

  it("is an envelope of three lines of JSON", () => {
    const target = parseSentryDsn("https://abc123@o42.ingest.sentry.io/4507")!;
    const lines = sentryEnvelope(target, event, AT).split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({
      event_id: "e".repeat(32),
      sent_at: AT.toISOString(),
      dsn: "https://o42.ingest.sentry.io/4507",
    });
    expect(JSON.parse(lines[1]!)).toEqual({ type: "event" });
    expect(JSON.parse(lines[2]!).event_id).toBe("e".repeat(32));
    // the key belongs in the auth header; the envelope's own header must not carry it
    expect(lines[0]).not.toContain("abc123");
  });
});

describe("the Sentry reporter", () => {
  const target = parseSentryDsn("https://abc123@o42.ingest.sentry.io/4507")!;

  it("posts the envelope with its key in the auth header, and gives up after two seconds", async () => {
    const { calls, send } = recorder();
    await new SentryReporter({
      target,
      environment: "test",
      send,
      newId: () => "f".repeat(32),
    }).error(report);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://o42.ingest.sentry.io/api/4507/envelope/");
    expect(calls[0]!.headers["content-type"]).toBe("application/x-sentry-envelope");
    expect(calls[0]!.headers["x-sentry-auth"]).toContain("sentry_key=abc123");
    expect(calls[0]!.body.split("\n")).toHaveLength(3);
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails with the service's name and status, and nothing else, when refused", async () => {
    const { send } = recorder({ ok: false, status: 403 });
    const failure = await new SentryReporter({ target, environment: "test", send })
      .error(report)
      .catch((e) => e);
    expect(failure).toBeInstanceOf(ReporterFailure);
    expect(failure).toMatchObject({ reporter: "sentry", status: 403 });
    expect(failure.message).toBe("sentry answered 403");
  });

  it("fails with the same plain message when the service cannot be reached, whatever went wrong", async () => {
    const { send } = recorder(new Error("connect ECONNREFUSED 10.1.2.3:443 for user chipo"));
    const failure = await new SentryReporter({ target, environment: "test", send })
      .error(report)
      .catch((e) => e);
    expect(failure.message).toBe("sentry could not be reached");
    expect(JSON.stringify(failure)).not.toContain("chipo");
  });
});

describe("the PostHog reporter", () => {
  it("posts one anonymous event", async () => {
    const { calls, send } = recorder();
    await new PostHogReporter({
      key: "phc_key",
      host: "https://eu.i.posthog.com/",
      send,
    }).analytics({
      name: "lesson_finished",
      properties: { resolved: 6, firstTry: 4 },
      at: AT,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://eu.i.posthog.com/capture/");
    expect(JSON.parse(calls[0]!.body)).toEqual({
      api_key: "phc_key",
      event: "lesson_finished",
      distinct_id: "zimtutor-server",
      properties: {
        resolved: 6,
        firstTry: 4,
        $process_person_profile: false,
        $lib: "zimtutor.http",
        $lib_version: "1.0.0",
      },
      timestamp: AT.toISOString(),
    });
  });

  it("is the same one name for every event: nothing can be traced to a child", async () => {
    const { calls, send } = recorder();
    const reporter = new PostHogReporter({ key: "k", host: "https://h.example.test", send });
    for (const name of ["a", "b", "c"]) await reporter.analytics({ name, properties: {}, at: AT });
    expect(new Set(calls.map((c) => JSON.parse(c.body).distinct_id)).size).toBe(1);
  });

  it("fails plainly when refused", async () => {
    const { send } = recorder({ ok: false, status: 401 });
    const failure = await new PostHogReporter({ key: "k", host: "https://h.example.test", send })
      .analytics({ name: "x", properties: {}, at: AT })
      .catch((e) => e);
    expect(failure).toMatchObject({ reporter: "posthog", status: 401 });
  });
});
