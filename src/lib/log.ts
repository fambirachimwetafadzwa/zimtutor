import { getMonitor, later } from "@/lib/monitoring";

/**
 * One-line JSON logs for the server, for counts and ids ONLY: never a child's words, a prompt or a
 * model's reply. (Hosting platforms collect stdout. Errors are also passed, scrubbed, to the monitor,
 * which does nothing unless an operator has turned reporting on: see lib/monitoring.)
 */
export function logEvent(event: string, fields: Record<string, unknown> = {}): void {
  if (process.env.NODE_ENV === "test") return;
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
}

export function logError(
  event: string,
  error: unknown,
  fields: Record<string, unknown> = {},
): void {
  if (process.env.NODE_ENV === "test") return;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(JSON.stringify({ at: new Date().toISOString(), event, error: message, ...fields }));
  later(getMonitor().error(event, error, fields));
}
