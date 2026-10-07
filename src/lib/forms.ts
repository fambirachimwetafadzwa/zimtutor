import type { z } from "zod";

/** Shape returned by every Server Action used with useActionState. */
export interface FormState {
  ok?: boolean;
  /** A single, plain-language message for the whole form. */
  error?: string;
  /** First problem per field, keyed by field name. */
  fieldErrors?: Record<string, string>;
  message?: string;
}

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
