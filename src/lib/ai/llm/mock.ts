import type { LlmProvider, LlmRequest, LlmResponse } from "./types";

/**
 * A model that only repeats the facts it was given. It never invents anything, so the whole tutor
 * (prompts, guards, fallbacks) can run offline and in tests with no network and no key.
 *
 * The prompt builders wrap the facts in <facts>…</facts> and the plain-text draft in <draft>…</draft>;
 * the default reply is the draft, which is what a careful model would also produce. Tests pass their
 * own handler to simulate a model that misbehaves (leaks an answer, invents a number, fails).
 */

export type MockHandler = (request: LlmRequest) => string | Promise<string>;

export interface MockProvider extends LlmProvider {
  /** Every request received, oldest first. */
  readonly calls: LlmRequest[];
}

const tagged = (text: string, tag: string): string | null => {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return match ? match[1]!.trim() : null;
};

export function createMockProvider(handler?: MockHandler): MockProvider {
  const calls: LlmRequest[] = [];
  return {
    name: "mock",
    model: "mock-1",
    calls,
    async generate(request: LlmRequest): Promise<LlmResponse> {
      calls.push(request);
      const lastUser =
        [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
      const text = handler
        ? await handler(request)
        : (tagged(lastUser, "draft") ?? tagged(lastUser, "facts") ?? "Let's keep going.");
      return { text, provider: "mock", model: "mock-1", stop: "end" };
    },
  };
}
