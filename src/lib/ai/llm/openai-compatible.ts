import { z } from "zod";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types";

/**
 * Any server that speaks POST {baseUrl}/chat/completions: other vendors, OpenRouter, Azure, and
 * self-hosted models (vLLM, Ollama). Plain `fetch`, no vendor SDK, so a school or ministry can
 * point ZimTutor at a model it hosts itself.
 */

export interface OpenAiCompatibleLlmConfig {
  baseUrl: string;
  /** Optional: self-hosted servers often need none. */
  apiKey?: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Injected in tests so retries do not really wait. */
  sleep?: (ms: number) => Promise<void>;
}

const responseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable().optional() }),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .optional(),
});

export function createOpenAiCompatibleLlm(config: OpenAiCompatibleLlmConfig): LlmProvider {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const doFetch = config.fetch ?? fetch;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = config.maxRetries ?? 1;

  return {
    name: "openai-compatible",
    model: config.model,
    async generate(request: LlmRequest): Promise<LlmResponse> {
      const body = JSON.stringify({
        model: config.model,
        max_tokens: request.maxTokens,
        messages: [{ role: "system", content: request.system }, ...request.messages],
      });
      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          response = await doFetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
            },
            body,
            signal: AbortSignal.timeout(config.timeoutMs ?? 20_000),
          });
        } catch (error) {
          const timedOut = error instanceof Error && error.name === "TimeoutError";
          if (attempt < maxRetries) {
            await sleep(400 * 2 ** attempt);
            continue;
          }
          throw new LlmError(
            timedOut
              ? "The model took too long to answer."
              : "The model service could not be reached.",
            timedOut ? "timeout" : "unavailable",
            true,
          );
        }
        if (response.status === 429 || response.status >= 500) {
          if (attempt < maxRetries) {
            await sleep(400 * 2 ** attempt);
            continue;
          }
          throw new LlmError(
            response.status === 429
              ? "The model service is busy (rate limited)."
              : `The model service failed (HTTP ${response.status}).`,
            response.status === 429 ? "rate_limited" : "unavailable",
            true,
          );
        }
        if (!response.ok) {
          const excerpt = (await response.text().catch(() => "")).slice(0, 200);
          throw new LlmError(
            `The model service rejected the request (HTTP ${response.status}): ${excerpt}`,
            "bad_request",
            false,
          );
        }
        const parsed = responseSchema.safeParse(await response.json().catch(() => null));
        if (!parsed.success)
          throw new LlmError(
            "The model service returned an unexpected response shape.",
            "invalid_response",
            false,
          );
        const choice = parsed.data.choices[0]!;
        if (choice.finish_reason === "content_filter")
          throw new LlmError("The model declined to answer.", "refused", false);
        const text = (choice.message.content ?? "").trim();
        if (text === "")
          throw new LlmError("The model returned no text.", "invalid_response", false);
        return {
          text,
          provider: "openai-compatible",
          model: parsed.data.model ?? config.model,
          stop: choice.finish_reason === "length" ? "length" : "end",
          ...(parsed.data.usage
            ? {
                usage: {
                  inputTokens: parsed.data.usage.prompt_tokens ?? 0,
                  outputTokens: parsed.data.usage.completion_tokens ?? 0,
                },
              }
            : {}),
        };
      }
    },
  };
}
