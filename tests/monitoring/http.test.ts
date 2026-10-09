import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createMonitor } from "../../src/lib/monitoring/monitor";
import {
  parseSentryDsn,
  PostHogReporter,
  ReporterFailure,
  SentryReporter,
  type Send,
} from "../../src/lib/monitoring/reporters";
import { Throttle } from "../../src/lib/monitoring/throttle";

/**
 * The reporters over a real network connection, to a stand-in for the service: what arrives is
 * exactly what would leave the machine, so this is where "nothing personal is sent" is proved.
 */

interface Received {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const servers: http.Server[] = [];

async function standIn(
  respond: (res: http.ServerResponse) => void = (res) => res.writeHead(200).end("{}"),
) {
  const received: Received[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      respond(res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { received, origin: `http://127.0.0.1:${port}` };
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

const send = fetch as unknown as Send;

describe("reporters over HTTP", () => {
  it("send Sentry an envelope it can read, with the key in the header", async () => {
    const { received, origin } = await standIn();
    const target = parseSentryDsn(`http://publickey@${origin.replace("http://", "")}/7`)!;
    const monitor = createMonitor({
      reporters: [new SentryReporter({ target, environment: "test", release: "r1", send })],
      throttle: new Throttle({ perKey: 5, total: 50, windowMs: 60_000 }),
    });
    await monitor.error("tutor_action_failed", new TypeError("boom"), { bucket: "tutor.ask" });

    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request).toMatchObject({ method: "POST", url: "/api/7/envelope/" });
    expect(request!.headers["content-type"]).toBe("application/x-sentry-envelope");
    expect(request!.headers["x-sentry-auth"]).toContain("sentry_key=publickey");
    const [header, item, event] = request!.body.split("\n").map((line) => JSON.parse(line));
    expect(header.dsn).toBe(`${origin}/7`);
    expect(item).toEqual({ type: "event" });
    expect(event).toMatchObject({
      level: "error",
      environment: "test",
      release: "r1",
      logger: "tutor_action_failed",
      exception: { values: [{ type: "TypeError", value: "boom" }] },
      tags: { event: "tutor_action_failed", bucket: "tutor.ask" },
    });
  });

  it("send PostHog an anonymous event", async () => {
    const { received, origin } = await standIn();
    const monitor = createMonitor({
      reporters: [new PostHogReporter({ key: "phc_test", host: origin, send })],
      throttle: new Throttle({ perKey: 5, total: 50, windowMs: 60_000 }),
    });
    await monitor.track({ name: "lesson_started", grade: 5, mode: "LEARN" });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ method: "POST", url: "/capture/" });
    expect(JSON.parse(received[0]!.body)).toMatchObject({
      api_key: "phc_test",
      event: "lesson_started",
      distinct_id: "zimtutor-server",
      properties: { grade: 5, mode: "LEARN", $process_person_profile: false },
    });
  });

  it("send nothing personal, whatever an error was carrying", async () => {
    const sentry = await standIn();
    const posthog = await standIn();
    const target = parseSentryDsn(`http://k@${sentry.origin.replace("http://", "")}/1`)!;
    const monitor = createMonitor({
      reporters: [
        new SentryReporter({ target, environment: "test", send }),
        new PostHogReporter({ key: "k", host: posthog.origin, send }),
      ],
      throttle: new Throttle({ perKey: 50, total: 500, windowMs: 60_000 }),
    });

    const error = Object.assign(
      new Error(
        "could not save: Key (username)=(chipo) already exists; learner 3f2b8c1e-7d4a-4b9e-a1c2-0123456789ab, " +
          'phone 077 123 4567, mail chipo.moyo@example.test, from 41.220.10.5, said "why do we carry the one my name is Chipo"',
      ),
      {
        code: "23505",
        details: "Key (username)=(chipo)",
        cause: new Error("my name is Chipo Moyo"),
      },
    );
    await monitor.error("tutor_action_failed", error, {
      learnerId: "3f2b8c1e-7d4a-4b9e-a1c2-0123456789ab",
      email: "chipo.moyo@example.test",
      text: "why do we carry the one my name is Chipo",
      bucket: "tutor.ask",
    });
    await monitor.track({
      name: "lesson_finished",
      resolved: 3,
      firstTry: 2,
      learnerId: "3f2b8c1e-7d4a-4b9e-a1c2-0123456789ab",
      text: "why do we carry the one my name is Chipo",
    } as never);

    const everything = [...sentry.received, ...posthog.received].map((r) => r.body).join("\n");
    expect(everything.length).toBeGreaterThan(100); // something really was sent
    for (const secret of [
      "chipo",
      "Chipo",
      "Moyo",
      "3f2b8c1e",
      "077 123 4567",
      "example.test",
      "41.220.10.5",
      "carry the one",
      "learnerId",
      "Key (username)",
    ])
      expect(everything, secret).not.toContain(secret);
  });

  it("give up on a service that does not answer, quickly, and say only that", async () => {
    const { origin } = await standIn(() => {
      /* never answers */
    });
    const started = Date.now();
    const failure = await new PostHogReporter({ key: "k", host: origin, send, timeoutMs: 150 })
      .analytics({ name: "x", properties: {}, at: new Date() })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(ReporterFailure);
    expect(failure.message).toBe("posthog could not be reached");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("report a refusal by its status and nothing the service said", async () => {
    const { origin } = await standIn((res) =>
      res.writeHead(403).end('{"detail":"invalid key for chipo@example.test"}'),
    );
    const failure = await new PostHogReporter({ key: "k", host: origin, send })
      .analytics({ name: "x", properties: {}, at: new Date() })
      .catch((e) => e);
    expect(failure).toMatchObject({ reporter: "posthog", status: 403 });
    expect(JSON.stringify(failure)).not.toContain("chipo");
    expect(failure.message).not.toContain("chipo");
  });

  it("cost the application nothing when the service is down", async () => {
    const monitor = createMonitor({
      // nothing listens on this port
      reporters: [
        new PostHogReporter({ key: "k", host: "http://127.0.0.1:9", send, timeoutMs: 500 }),
      ],
      throttle: new Throttle({ perKey: 5, total: 50, windowMs: 60_000 }),
    });
    await expect(
      monitor.track({ name: "limit_reached", bucket: "tutor.ask" }),
    ).resolves.toBeUndefined();
  });
});
