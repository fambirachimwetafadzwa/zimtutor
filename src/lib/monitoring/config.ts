import {
  parseSentryDsn,
  PostHogReporter,
  SentryReporter,
  type Reporter,
  type Send,
} from "./reporters";

/**
 * Which services to report to, from the environment. Nothing is on by default: with none of these
 * set, ZimTutor reports to no one.
 *
 *   SENTRY_DSN          errors, to Sentry (SENTRY_ENVIRONMENT and SENTRY_RELEASE are optional)
 *   POSTHOG_KEY and POSTHOG_HOST   counts, to PostHog (the host is named, never guessed, so that
 *                       where the data goes is always a decision somebody made)
 */
export function reportersFromEnv(
  env: Record<string, string | undefined>,
  send: Send,
): { reporters: Reporter[]; problems: string[] } {
  const reporters: Reporter[] = [];
  const problems: string[] = [];
  const set = (name: string) => env[name]?.trim() || undefined;

  const dsn = set("SENTRY_DSN");
  if (dsn) {
    const target = parseSentryDsn(dsn);
    if (target) {
      reporters.push(
        new SentryReporter({
          target,
          environment: set("SENTRY_ENVIRONMENT") ?? set("NODE_ENV") ?? "production",
          release: set("SENTRY_RELEASE") ?? set("VERCEL_GIT_COMMIT_SHA"),
          send,
        }),
      );
    } else problems.push("SENTRY_DSN is not a Sentry address (https://<key>@<host>/<project>)");
  }

  const key = set("POSTHOG_KEY");
  const host = set("POSTHOG_HOST");
  if (key || host) {
    if (key && host && /^https:\/\/[^\s/]+/.test(host))
      reporters.push(new PostHogReporter({ key, host, send }));
    else problems.push("PostHog needs both POSTHOG_KEY and POSTHOG_HOST (an https address)");
  }
  return { reporters, problems };
}
