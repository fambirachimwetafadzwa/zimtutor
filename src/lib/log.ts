/**
 * One-line JSON logs for the server, for counts and ids ONLY: never a child's words, a prompt or a
 * model's reply. (Hosting platforms collect stdout; Sentry and PostHog hook in here later.)
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
}
