import type { ServerEnv } from "../../env";
import { createAnthropicProvider } from "./anthropic";
import { createMockProvider } from "./mock";
import { createOpenAiCompatibleLlm } from "./openai-compatible";
import { LlmError, type LlmProvider } from "./types";

/** The configured language model (AI_PROVIDER). */
export function llmProviderFromEnv(
  env: Pick<
    ServerEnv,
    | "aiProvider"
    | "aiModel"
    | "aiEffort"
    | "anthropicApiKey"
    | "openaiCompatibleBaseUrl"
    | "openaiCompatibleApiKey"
  >,
): LlmProvider {
  switch (env.aiProvider) {
    case "mock":
      return createMockProvider();
    case "anthropic": {
      if (!env.anthropicApiKey || !env.aiModel)
        throw new LlmError(
          "AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY and AI_MODEL.",
          "bad_request",
          false,
        );
      return createAnthropicProvider({
        apiKey: env.anthropicApiKey,
        model: env.aiModel,
        ...(env.aiEffort ? { effort: env.aiEffort } : {}),
      });
    }
    case "openai-compatible": {
      if (!env.openaiCompatibleBaseUrl || !env.aiModel)
        throw new LlmError(
          "AI_PROVIDER=openai-compatible needs OPENAI_COMPATIBLE_BASE_URL and AI_MODEL.",
          "bad_request",
          false,
        );
      return createOpenAiCompatibleLlm({
        baseUrl: env.openaiCompatibleBaseUrl,
        model: env.aiModel,
        ...(env.openaiCompatibleApiKey ? { apiKey: env.openaiCompatibleApiKey } : {}),
      });
    }
  }
}
