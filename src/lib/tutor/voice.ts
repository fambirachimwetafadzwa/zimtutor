import { checkTutorText, type GuardFailure } from "../ai/guards";
import { LlmError, type LlmProvider } from "../ai/llm/types";
import type { TutorMove, VoiceResult } from "./moves";
import { buildPrompt, usesModel } from "./prompts";
import { templateText } from "./template-voice";

/**
 * Turning a move into words.
 *
 *   – Always: the plain template text exists (template-voice.ts) and is the fallback for everything.
 *   – With a language model configured: for moves that benefit from warmer wording, the model is
 *     given the facts and the draft, and its reply is used ONLY if it passes every guard
 *     (src/lib/ai/guards.ts). A provider error, a timeout, a refusal or a failed guard all mean the
 *     child simply reads the template text, so the tutor never breaks because a model did.
 *
 * Failures are reported through `onEvent` (counts and reasons only: no child's text, no prompt) so
 * they can be logged; a model that keeps failing is left alone for a while (a circuit breaker) rather
 * than making every message wait for a timeout.
 */

export interface VoiceEvent {
  kind: "model_used" | "model_rejected" | "model_error" | "model_skipped";
  move: TutorMove["kind"];
  reasons?: string[];
  latencyMs?: number;
  provider?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface VoiceOptions {
  /** Null (or absent) means template text only. */
  provider?: LlmProvider | null;
  /** After this many failures in a row the model is left alone for `coolOffMs`. Default 3 and 60 s. */
  breaker?: { failures: number; coolOffMs: number };
  now?: () => number;
  onEvent?: (event: VoiceEvent) => void;
}

export interface TutorVoice {
  say(move: TutorMove): Promise<VoiceResult>;
}

export function createVoice(options: VoiceOptions = {}): TutorVoice {
  const { provider = null, onEvent } = options;
  const now = options.now ?? Date.now;
  const limit = options.breaker ?? { failures: 3, coolOffMs: 60_000 };
  let failuresInARow = 0;
  let openUntil = 0;

  const emit = (event: VoiceEvent) => {
    try {
      onEvent?.(event);
    } catch {
      // a broken logger must never break the tutor
    }
  };

  return {
    async say(move) {
      const draft = templateText(move);
      const plain: VoiceResult = { text: draft, source: "template" };
      if (!provider || !usesModel(move)) return plain;

      if (now() < openUntil) {
        emit({ kind: "model_skipped", move: move.kind, reasons: ["circuit open"] });
        return { ...plain, fallback: ["MODEL_PAUSED"] };
      }

      const prompt = buildPrompt(move, draft);
      const started = now();
      let response;
      try {
        response = await provider.generate(prompt.request);
      } catch (error) {
        failuresInARow++;
        if (failuresInARow >= limit.failures) {
          openUntil = now() + limit.coolOffMs;
          failuresInARow = 0;
        }
        const reason =
          error instanceof LlmError ? `MODEL_${error.kind.toUpperCase()}` : "MODEL_ERROR";
        emit({
          kind: "model_error",
          move: move.kind,
          reasons: [reason],
          latencyMs: now() - started,
          provider: provider.name,
          model: provider.model,
        });
        return { ...plain, fallback: [reason] };
      }
      failuresInARow = 0;

      const secret = "secret" in move ? move.secret : undefined;
      const guard = checkTutorText({
        text: response.text,
        maxWords: prompt.limits.words,
        truncated: response.stop === "length",
        sources: prompt.sources,
        ...(secret ? { secret } : {}),
        ...(move.kind === "FEEDBACK" ? { verdict: move.verdict } : {}),
      });
      if (!guard.ok) {
        const reasons: GuardFailure[] = guard.failures;
        emit({
          kind: "model_rejected",
          move: move.kind,
          reasons,
          latencyMs: now() - started,
          provider: response.provider,
          model: response.model,
        });
        return { ...plain, fallback: reasons };
      }
      emit({
        kind: "model_used",
        move: move.kind,
        latencyMs: now() - started,
        provider: response.provider,
        model: response.model,
        ...(response.usage ? { usage: response.usage } : {}),
      });
      return {
        text: guard.text,
        source: "model",
        model: { provider: response.provider, name: response.model },
      };
    },
  };
}
