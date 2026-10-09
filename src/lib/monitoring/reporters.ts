import type { DescribedError, SafeFields } from "./scrub";

/** What is sent to an error service: already scrubbed, and nothing else. */
export interface ErrorReport {
  event: string;
  error: DescribedError;
  fields: SafeFields;
  at: Date;
}

/** What is sent to an analytics service: a name and a few plain facts. */
export interface AnalyticsReport {
  name: string;
  properties: SafeFields;
  at: Date;
}

export interface Reporter {
  readonly name: string;
  error?(report: ErrorReport): Promise<void>;
  analytics?(report: AnalyticsReport): Promise<void>;
}

/** The part of `fetch` that is used (so tests can stand in for the network). */
export type Send = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

/** Said when a service could not be reached or refused: which one, and the HTTP status, nothing more. */
export class ReporterFailure extends Error {
  constructor(
    readonly reporter: string,
    readonly status?: number,
  ) {
    super(status ? `${reporter} answered ${status}` : `${reporter} could not be reached`);
    this.name = "ReporterFailure";
  }
}

const SDK = { name: "zimtutor.http", version: "1.0.0" } as const;
const TIMEOUT_MS = 2000;

async function post(
  reporter: string,
  send: Send,
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<void> {
  let response;
  try {
    response = await send(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ReporterFailure(reporter);
  }
  if (!response.ok) throw new ReporterFailure(reporter, response.status);
}

// ── Sentry ─────────────────────────────────────────────────────────────────────────────────────

export interface SentryTarget {
  /** Where envelopes go. */
  url: string;
  publicKey: string;
  /** The DSN without its key, which is all an envelope's header needs to say. */
  dsn: string;
}

/** https://<key>@<host>/<project> becomes the place to send envelopes; anything else is no DSN. */
export function parseSentryDsn(value: string): SentryTarget | null {
  try {
    const url = new URL(value);
    const project = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!/^https?:$/.test(url.protocol) || !url.username || !/^\d+$/.test(project)) return null;
    return {
      url: `${url.protocol}//${url.host}/api/${project}/envelope/`,
      publicKey: decodeURIComponent(url.username),
      dsn: `${url.protocol}//${url.host}/${project}`,
    };
  } catch {
    return null;
  }
}

/** "at fn (file:line:col)" or "at file:line:col" as the frame an error service wants. */
export function sentryFrame(line: string) {
  const match = /^at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
  if (!match) return { filename: line.replace(/^at /, "") };
  const [, fn, filename = "", lineno, colno] = match;
  return {
    ...(fn ? { function: fn } : {}),
    filename,
    lineno: Number(lineno),
    colno: Number(colno),
    in_app: !filename.includes("node_modules"),
  };
}

export function sentryEvent(
  report: ErrorReport,
  context: { environment: string; release?: string | undefined },
  eventId: string,
) {
  return {
    event_id: eventId,
    timestamp: report.at.getTime() / 1000,
    platform: "node",
    level: "error",
    logger: report.event,
    environment: context.environment,
    ...(context.release ? { release: context.release } : {}),
    exception: {
      values: [
        {
          type: report.error.name,
          value: report.error.message,
          // an error service wants the oldest call first
          stacktrace: { frames: [...report.error.frames].reverse().map(sentryFrame) },
        },
      ],
    },
    tags: {
      event: report.event,
      ...(report.error.code ? { code: report.error.code } : {}),
      ...Object.fromEntries(Object.entries(report.fields).map(([k, v]) => [k, String(v)])),
    },
    sdk: SDK,
  };
}

export function sentryEnvelope(
  target: SentryTarget,
  event: ReturnType<typeof sentryEvent>,
  sentAt: Date,
): string {
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: sentAt.toISOString(), dsn: target.dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

/** Errors to Sentry, over HTTP and without its SDK: what is sent is exactly what is built above. */
export class SentryReporter implements Reporter {
  readonly name = "sentry";

  constructor(
    private readonly options: {
      target: SentryTarget;
      environment: string;
      release?: string | undefined;
      send: Send;
      newId?: () => string;
      timeoutMs?: number;
    },
  ) {}

  async error(report: ErrorReport): Promise<void> {
    const id = (this.options.newId ?? (() => crypto.randomUUID().replaceAll("-", "")))();
    const event = sentryEvent(report, this.options, id);
    await post(
      this.name,
      this.options.send,
      this.options.target.url,
      {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_client=${SDK.name}/${SDK.version}, sentry_key=${this.options.target.publicKey}`,
      },
      sentryEnvelope(this.options.target, event, report.at),
      this.options.timeoutMs ?? TIMEOUT_MS,
    );
  }
}

// ── PostHog ────────────────────────────────────────────────────────────────────────────────────

/** Counts to PostHog, over HTTP. Every event is anonymous: no person is made, none is named. */
export class PostHogReporter implements Reporter {
  readonly name = "posthog";

  constructor(
    private readonly options: { key: string; host: string; send: Send; timeoutMs?: number },
  ) {}

  async analytics(report: AnalyticsReport): Promise<void> {
    await post(
      this.name,
      this.options.send,
      `${this.options.host.replace(/\/+$/, "")}/capture/`,
      { "content-type": "application/json" },
      JSON.stringify({
        api_key: this.options.key,
        event: report.name,
        // one name for everything the server counts: events cannot be traced to a child
        distinct_id: "zimtutor-server",
        properties: {
          ...report.properties,
          $process_person_profile: false,
          $lib: SDK.name,
          $lib_version: SDK.version,
        },
        timestamp: report.at.toISOString(),
      }),
      this.options.timeoutMs ?? TIMEOUT_MS,
    );
  }
}
