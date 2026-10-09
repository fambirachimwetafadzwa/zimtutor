import type { AnalyticsEvent } from "./events";
import type { Reporter } from "./reporters";
import { describeError, routeOnly, safeFields } from "./scrub";
import type { Throttle } from "./throttle";

export interface Monitor {
  /** Report a fault. Resolves when the reporters are done; never rejects. */
  error(event: string, error: unknown, fields?: Record<string, unknown>): Promise<void>;
  /** Count something that happened. Resolves when the reporters are done; never rejects. */
  track(event: AnalyticsEvent): Promise<void>;
}

export interface MonitorDeps {
  reporters: readonly Reporter[];
  throttle: Throttle;
  now?: () => Date;
  /** Told when a reporter fails: its name and an HTTP status at most. */
  onFailure?: (reporter: string, status?: number) => void;
}

/**
 * Faults and counts, scrubbed and passed on. With no reporter configured it does nothing at all
 * (monitoring is off unless an operator turns it on), and a reporter that fails or is slow costs
 * the application nothing: every failure is swallowed here.
 */
export function createMonitor(deps: MonitorDeps): Monitor {
  const now = deps.now ?? (() => new Date());

  const safely = async (reporter: Reporter, work: () => Promise<void> | undefined) => {
    try {
      await work();
    } catch (failure) {
      const status = (failure as { status?: unknown } | null)?.status;
      try {
        deps.onFailure?.(reporter.name, typeof status === "number" ? status : undefined);
      } catch {
        // reporting a failure must not fail either
      }
    }
  };

  return {
    async error(event, error, fields) {
      const receivers = deps.reporters.filter((r) => r.error);
      if (receivers.length === 0) return;
      try {
        const described = describeError(error);
        if (!deps.throttle.allow(`${event}|${described.name}|${described.message.slice(0, 60)}`))
          return;
        const report = {
          event: /^[a-z][a-z0-9_.]{1,60}$/.test(event) ? event : "error",
          error: described,
          fields: safeFields({
            ...fields,
            ...(typeof fields?.route === "string" ? { route: routeOnly(fields.route) } : {}),
          }),
          at: now(),
        };
        await Promise.all(receivers.map((r) => safely(r, () => r.error?.(report))));
      } catch {
        // building a report must not fail the thing being reported on
      }
    },

    async track(event) {
      const receivers = deps.reporters.filter((r) => r.analytics);
      if (receivers.length === 0) return;
      try {
        const { name, ...rest } = event;
        const report = { name, properties: safeFields(rest), at: now() };
        await Promise.all(receivers.map((r) => safely(r, () => r.analytics?.(report))));
      } catch {
        // as above
      }
    },
  };
}

/** A monitor that reports nothing (the default). */
export const silentMonitor: Monitor = createMonitor({
  reporters: [],
  throttle: { allow: () => false } as unknown as Throttle,
});
