import "server-only";
import { after } from "next/server";
import { reportersFromEnv } from "./config";
import { createMonitor, type Monitor } from "./monitor";
import type { Send } from "./reporters";
import { Throttle } from "./throttle";

/** One line on the server's output, for counts and names only (never anything a report carried). */
function say(fields: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test") return;
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...fields })}\n`);
}

let cached: Monitor | undefined;

/** The monitor the running application uses (see config.ts for how it is turned on). */
export function getMonitor(): Monitor {
  if (cached) return cached;
  const { reporters, problems } = reportersFromEnv(process.env, fetch as unknown as Send);
  for (const problem of problems) say({ event: "monitoring_misconfigured", problem });
  cached = createMonitor({
    reporters,
    throttle: new Throttle({ perKey: 3, total: 30, windowMs: 60_000 }),
    onFailure: (reporter, status) =>
      say({ event: "monitoring_failed", reporter, ...(status ? { status } : {}) }),
  });
  return cached;
}

/**
 * Let reporting finish after the response has been sent, where there is a response to wait for (a
 * platform may stop the server the moment it has answered); elsewhere just let it run.
 */
export function later(work: Promise<void>): void {
  try {
    after(() => work);
  } catch {
    void work;
  }
}
