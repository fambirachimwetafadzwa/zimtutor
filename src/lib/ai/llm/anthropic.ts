import Anthropic from "@anthropic-ai/sdk";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types";

/**
 * Claude through the official Anthropic SDK.
 *
 * Only what a short tutoring reply needs is sent: a system prompt, the conversation, a token limit
 * and, when configured, an effort level. No sampling parameters (current models reject non-default
 * values) and no assistant prefill. The model name comes from configuration (AI_MODEL): it is never
 * chosen in code, so changing models is a deployment decision.
 */

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  /** Thinking depth for models that support it (output_config.effort). Omit to use the model's default. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
  maxRetries?: number;
  /** Injected in tests. */
  client?: Anthropic;
}

export function createAnthropicProvider(config: AnthropicConfig): LlmProvider {
  const client =
    config.client ??
    new Anthropic({
      apiKey: config.apiKey,
      // A child is waiting: fail fast and let the template text take over.
      timeout: config.timeoutMs ?? 20_000,
      maxRetries: config.maxRetries ?? 1,
    });

  return {
    name: "anthropic",
    model: config.model,
    async generate(request: LlmRequest): Promise<LlmResponse> {
      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model: config.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          ...(config.effort ? { output_config: { effort: config.effort } } : {}),
        });
      } catch (error) {
        throw toLlmError(error);
      }
      if (response.stop_reason === "refusal")
        throw new LlmError("The model declined to answer.", "refused", false);
      const text = response.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("")
        .trim();
      if (text === "")
        throw new LlmError(
          response.stop_reason === "max_tokens"
            ? "The reply ran out of tokens before any text was written."
            : "The model returned no text.",
          "invalid_response",
          false,
        );
      return {
        text,
        provider: "anthropic",
        model: response.model,
        stop: response.stop_reason === "max_tokens" ? "length" : "end",
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
}

function toLlmError(error: unknown): LlmError {
  if (error instanceof Anthropic.APIConnectionTimeoutError)
    return new LlmError("The model took too long to answer.", "timeout", true);
  if (error instanceof Anthropic.APIConnectionError)
    return new LlmError("The model service could not be reached.", "unavailable", true);
  if (error instanceof Anthropic.RateLimitError)
    return new LlmError("The model service is busy (rate limited).", "rate_limited", true);
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  )
    return new LlmError("The model service refused our credentials.", "bad_request", false);
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError)
    // the message says what was wrong with OUR request (e.g. an unknown model); it contains no learner text
    return new LlmError(
      `The model service rejected the request: ${error.message}`.slice(0, 300),
      "bad_request",
      false,
    );
  if (error instanceof Anthropic.APIError)
    return new LlmError(
      `The model service failed (HTTP ${error.status ?? "?"}).`,
      "unavailable",
      (error.status ?? 500) >= 500,
    );
  return new LlmError("The model call failed unexpectedly.", "unavailable", false);
}
