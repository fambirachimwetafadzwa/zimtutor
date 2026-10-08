/**
 * The language-model layer.
 *
 * A model may EXPLAIN, rephrase hints, encourage and answer a child's question inside the objective
 * being taught. It is never asked whether an answer is right and never calculates mastery: marking
 * and mastery are deterministic code (src/lib/marking, src/lib/mastery). Everything a model writes
 * is checked before a child sees it (src/lib/ai/guards.ts) and replaced by the plain template text
 * when it fails a check or the provider is unavailable, so the tutor works with no model at all.
 *
 * Deliberately free of `server-only`: tests and offline tools import it.
 */

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

/** What a call is for. Used for logs and tests; never sent to the provider. */
export type LlmPurpose =
  | "INTRODUCE"
  | "EXPLAIN"
  | "WORKED_EXAMPLE"
  | "FEEDBACK"
  | "HINT"
  | "CORRECTION"
  | "TRANSITION"
  | "ANSWER_QUESTION";

export interface LlmRequest {
  /** The rules, then the curriculum context. Stable text first so providers can cache it. */
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  purpose: LlmPurpose;
}

export interface LlmResponse {
  text: string;
  provider: string;
  model: string;
  /** "length": the reply was cut off at the token limit. */
  stop: "end" | "length";
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  /** "anthropic", "openai-compatible" or "mock". */
  readonly name: string;
  readonly model: string;
  generate(request: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorKind =
  "unavailable" | "rate_limited" | "timeout" | "refused" | "bad_request" | "invalid_response";

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
    /** Whether trying again later could work. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
