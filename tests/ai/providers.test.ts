import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnthropicProvider } from "../../src/lib/ai/llm/anthropic";
import { llmProviderFromEnv } from "../../src/lib/ai/llm/factory";
import { createMockProvider } from "../../src/lib/ai/llm/mock";
import { createOpenAiCompatibleLlm } from "../../src/lib/ai/llm/openai-compatible";
import { LlmError, type LlmRequest } from "../../src/lib/ai/llm/types";

const request: LlmRequest = {
  system: "You are a tutor.",
  messages: [{ role: "user", content: "<facts>x</facts><draft>Hello there.</draft>" }],
  maxTokens: 300,
  purpose: "HINT",
};

const rejection = async (promise: Promise<unknown>): Promise<LlmError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmError);
    return error as LlmError;
  }
  throw new Error("expected the call to fail");
};

describe("the mock model", () => {
  it("repeats the draft, else the facts, else a stock line", async () => {
    const mock = createMockProvider();
    expect((await mock.generate(request)).text).toBe("Hello there.");
    const factsOnly = await mock.generate({
      ...request,
      messages: [{ role: "user", content: "<facts>just facts</facts>" }],
    });
    expect(factsOnly.text).toBe("just facts");
    const bare = await mock.generate({ ...request, messages: [{ role: "user", content: "hi" }] });
    expect(bare.text).toBe("Let's keep going.");
    expect(mock.calls).toHaveLength(3);
    expect(mock.name).toBe("mock");
  });

  it("can be told to misbehave", async () => {
    const mock = createMockProvider(() => "The answer is 42.");
    expect((await mock.generate(request)).text).toBe("The answer is 42.");
    const failing = createMockProvider(() => {
      throw new LlmError("down", "unavailable", true);
    });
    expect((await rejection(failing.generate(request))).kind).toBe("unavailable");
  });
});

describe("the Anthropic model", () => {
  const message = (overrides: Record<string, unknown> = {}) => ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "served-model",
    content: [{ type: "text", text: "  Try the ones column first.  " }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 14 },
    ...overrides,
  });
  const fakeClient = (create: (...args: unknown[]) => unknown) =>
    ({ messages: { create } }) as unknown as Anthropic;

  it("sends the system prompt, the conversation and the limit, and reads the reply", async () => {
    const create = vi.fn(async (..._args: unknown[]) => message());
    const provider = createAnthropicProvider({
      apiKey: "key",
      model: "configured-model",
      client: fakeClient(create),
    });
    const response = await provider.generate(request);
    expect(create).toHaveBeenCalledWith({
      model: "configured-model",
      max_tokens: 300,
      system: "You are a tutor.",
      messages: [{ role: "user", content: request.messages[0]!.content }],
    });
    expect(response).toEqual({
      text: "Try the ones column first.",
      provider: "anthropic",
      model: "served-model",
      stop: "end",
      usage: { inputTokens: 120, outputTokens: 14 },
    });
    expect(provider.model).toBe("configured-model");
  });

  it("passes the effort level only when one is configured", async () => {
    const create = vi.fn(async (..._args: unknown[]) => message());
    await createAnthropicProvider({
      apiKey: "k",
      model: "m",
      effort: "low",
      client: fakeClient(create),
    }).generate(request);
    expect(create.mock.calls[0]![0]).toMatchObject({ output_config: { effort: "low" } });
    const plain = vi.fn(async (..._args: unknown[]) => message());
    await createAnthropicProvider({ apiKey: "k", model: "m", client: fakeClient(plain) }).generate(
      request,
    );
    expect(plain.mock.calls[0]![0]).not.toHaveProperty("output_config");
    // nothing that current models reject is ever sent
    expect(plain.mock.calls[0]![0]).not.toHaveProperty("temperature");
    expect(plain.mock.calls[0]![0]).not.toHaveProperty("top_p");
  });

  it("joins text blocks, ignores other blocks, and marks a reply cut off at the limit", async () => {
    const create = vi.fn(async () =>
      message({
        content: [
          { type: "thinking", thinking: "…", signature: "s" },
          { type: "text", text: "Part one. " },
          { type: "text", text: "Part two." },
        ],
        stop_reason: "max_tokens",
      }),
    );
    const response = await createAnthropicProvider({
      apiKey: "k",
      model: "m",
      client: fakeClient(create),
    }).generate(request);
    expect(response.text).toBe("Part one. Part two.");
    expect(response.stop).toBe("length");
  });

  it("treats a refusal and an empty reply as failures", async () => {
    const refusal = createAnthropicProvider({
      apiKey: "k",
      model: "m",
      client: fakeClient(async () => message({ content: [], stop_reason: "refusal" })),
    });
    const refused = await rejection(refusal.generate(request));
    expect([refused.kind, refused.retryable]).toEqual(["refused", false]);

    const empty = createAnthropicProvider({
      apiKey: "k",
      model: "m",
      client: fakeClient(async () => message({ content: [], stop_reason: "end_turn" })),
    });
    expect((await rejection(empty.generate(request))).kind).toBe("invalid_response");

    const noRoom = createAnthropicProvider({
      apiKey: "k",
      model: "m",
      client: fakeClient(async () => message({ content: [], stop_reason: "max_tokens" })),
    });
    expect((await rejection(noRoom.generate(request))).message).toMatch(/ran out of tokens/);
  });

  it.each([
    [() => new Anthropic.APIConnectionTimeoutError(), "timeout", true],
    [() => new Anthropic.APIConnectionError({ message: "offline" }), "unavailable", true],
    [
      () =>
        new Anthropic.RateLimitError(
          429,
          { error: { message: "slow down" } },
          "slow",
          new Headers(),
        ),
      "rate_limited",
      true,
    ],
    [
      () =>
        new Anthropic.AuthenticationError(
          401,
          { error: { message: "bad key" } },
          "bad key",
          new Headers(),
        ),
      "bad_request",
      false,
    ],
    [() => new Anthropic.PermissionDeniedError(403, {}, "no", new Headers()), "bad_request", false],
    [
      () =>
        new Anthropic.BadRequestError(
          400,
          { error: { message: "model: nope" } },
          "model: nope",
          new Headers(),
        ),
      "bad_request",
      false,
    ],
    [
      () => new Anthropic.InternalServerError(503, {}, "overloaded", new Headers()),
      "unavailable",
      true,
    ],
    [() => new Anthropic.APIError(418, {}, "teapot", new Headers()), "unavailable", false],
    [() => new Error("something else"), "unavailable", false],
  ] as const)("maps SDK error %#", async (make, kind, retryable) => {
    const provider = createAnthropicProvider({
      apiKey: "k",
      model: "m",
      client: fakeClient(async () => {
        throw make();
      }),
    });
    const error = await rejection(provider.generate(request));
    expect([error.kind, error.retryable]).toEqual([kind, retryable]);
    // what a child typed never travels in an error message
    expect(error.message).not.toContain("Hello there");
  });
});

describe("the OpenAI-compatible model", () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    model: "served",
    choices: [{ finish_reason: "stop", message: { content: " Look at the tens. " } }],
    usage: { prompt_tokens: 50, completion_tokens: 6 },
    ...overrides,
  });
  const json = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  const noSleep = vi.fn(async () => {});
  beforeEach(() => noSleep.mockClear());

  it("posts to chat/completions with the key and the system prompt first", async () => {
    const fetchMock = vi.fn(async () => json(200, body()));
    const provider = createOpenAiCompatibleLlm({
      baseUrl: "https://llm.example/v1/",
      apiKey: "secret",
      model: "m1",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const response = await provider.generate(request);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "m1",
      max_tokens: 300,
      messages: [
        { role: "system", content: "You are a tutor." },
        { role: "user", content: request.messages[0]!.content },
      ],
    });
    expect(response).toEqual({
      text: "Look at the tens.",
      provider: "openai-compatible",
      model: "served",
      stop: "end",
      usage: { inputTokens: 50, outputTokens: 6 },
    });
  });

  it("sends no authorisation header for a server that needs none", async () => {
    const fetchMock = vi.fn(async () => json(200, body()));
    await createOpenAiCompatibleLlm({
      baseUrl: "http://localhost:11434/v1",
      model: "local",
      fetch: fetchMock as unknown as typeof fetch,
    }).generate(request);
    const init = (fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1];
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("reports a reply cut off at the limit", async () => {
    const fetchMock = vi.fn(async () =>
      json(200, body({ choices: [{ finish_reason: "length", message: { content: "Half a" } }] })),
    );
    const response = await createOpenAiCompatibleLlm({
      baseUrl: "http://x/v1",
      model: "m",
      fetch: fetchMock as unknown as typeof fetch,
    }).generate(request);
    expect(response.stop).toBe("length");
  });

  it("retries a busy or failing server once, then gives up with a clear kind", async () => {
    const flaky = vi
      .fn()
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(json(200, body()));
    const ok = await createOpenAiCompatibleLlm({
      baseUrl: "http://x/v1",
      model: "m",
      fetch: flaky as unknown as typeof fetch,
      sleep: noSleep,
    }).generate(request);
    expect(ok.text).toBe("Look at the tens.");
    expect(noSleep).toHaveBeenCalledWith(400);

    const busy = vi.fn(async () => json(429, {}));
    const rateLimited = await rejection(
      createOpenAiCompatibleLlm({
        baseUrl: "http://x/v1",
        model: "m",
        fetch: busy as unknown as typeof fetch,
        sleep: noSleep,
      }).generate(request),
    );
    expect([rateLimited.kind, rateLimited.retryable]).toEqual(["rate_limited", true]);
    expect(busy).toHaveBeenCalledTimes(2);

    const down = vi.fn(async () => json(503, {}));
    const unavailable = await rejection(
      createOpenAiCompatibleLlm({
        baseUrl: "http://x/v1",
        model: "m",
        maxRetries: 0,
        fetch: down as unknown as typeof fetch,
        sleep: noSleep,
      }).generate(request),
    );
    expect(unavailable.kind).toBe("unavailable");
    expect(down).toHaveBeenCalledTimes(1);
  });

  it("does not retry a request the server rejected", async () => {
    const rejectedFetch = vi.fn(async () => json(400, { error: "unknown model" }));
    const error = await rejection(
      createOpenAiCompatibleLlm({
        baseUrl: "http://x/v1",
        model: "m",
        fetch: rejectedFetch as unknown as typeof fetch,
        sleep: noSleep,
      }).generate(request),
    );
    expect([error.kind, error.retryable]).toEqual(["bad_request", false]);
    expect(rejectedFetch).toHaveBeenCalledTimes(1);
    expect(error.message).toContain("unknown model");
  });

  it("recognises timeouts, network failures and odd responses", async () => {
    const timeout = Object.assign(new Error("slow"), { name: "TimeoutError" });
    const slow = await rejection(
      createOpenAiCompatibleLlm({
        baseUrl: "http://x/v1",
        model: "m",
        maxRetries: 0,
        fetch: (async () => {
          throw timeout;
        }) as unknown as typeof fetch,
      }).generate(request),
    );
    expect(slow.kind).toBe("timeout");

    const offline = await rejection(
      createOpenAiCompatibleLlm({
        baseUrl: "http://x/v1",
        model: "m",
        maxRetries: 0,
        fetch: (async () => {
          throw new TypeError("fetch failed");
        }) as unknown as typeof fetch,
      }).generate(request),
    );
    expect(offline.kind).toBe("unavailable");

    for (const [payload, kind] of [
      [{ nonsense: true }, "invalid_response"],
      [
        body({ choices: [{ finish_reason: "stop", message: { content: "  " } }] }),
        "invalid_response",
      ],
      [
        body({ choices: [{ finish_reason: "content_filter", message: { content: "x" } }] }),
        "refused",
      ],
    ] as const) {
      const provider = createOpenAiCompatibleLlm({
        baseUrl: "http://x/v1",
        model: "m",
        fetch: (async () => json(200, payload)) as unknown as typeof fetch,
      });
      expect((await rejection(provider.generate(request))).kind).toBe(kind);
    }
  });
});

describe("choosing the model from the environment", () => {
  const base = {
    aiProvider: "mock" as const,
    aiModel: undefined,
    aiEffort: undefined,
    anthropicApiKey: undefined,
    openaiCompatibleBaseUrl: undefined,
    openaiCompatibleApiKey: undefined,
  };

  it("gives the offline model by default", () => {
    expect(llmProviderFromEnv(base).name).toBe("mock");
  });

  it("builds each real provider when it is fully configured, with the configured model name", () => {
    const claude = llmProviderFromEnv({
      ...base,
      aiProvider: "anthropic",
      aiModel: "model-from-config",
      anthropicApiKey: "k",
    });
    expect([claude.name, claude.model]).toEqual(["anthropic", "model-from-config"]);
    const other = llmProviderFromEnv({
      ...base,
      aiProvider: "openai-compatible",
      aiModel: "local-model",
      openaiCompatibleBaseUrl: "http://localhost:11434/v1",
    });
    expect([other.name, other.model]).toEqual(["openai-compatible", "local-model"]);
  });

  it("refuses a half-configured provider with a message that names what is missing", () => {
    expect(() => llmProviderFromEnv({ ...base, aiProvider: "anthropic", aiModel: "m" })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
    expect(() =>
      llmProviderFromEnv({ ...base, aiProvider: "anthropic", anthropicApiKey: "k" }),
    ).toThrow(/AI_MODEL/);
    expect(() =>
      llmProviderFromEnv({ ...base, aiProvider: "openai-compatible", aiModel: "m" }),
    ).toThrow(/OPENAI_COMPATIBLE_BASE_URL/);
  });
});

describe("reading the AI settings from process.env", () => {
  const keys = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "AI_PROVIDER",
    "AI_MODEL",
    "AI_EFFORT",
    "ANTHROPIC_API_KEY",
    "OPENAI_COMPATIBLE_BASE_URL",
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
    for (const k of keys) delete process.env[k];
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    vi.resetModules();
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.resetModules();
  });

  const load = async () => (await import("../../src/lib/env")).readServerEnv();

  it("defaults to the offline model and needs no key", async () => {
    const env = await load();
    expect(env.aiProvider).toBe("mock");
    expect(env.aiModel).toBeUndefined();
  });

  it("requires a key and a model for Anthropic, and checks the effort level", async () => {
    process.env.AI_PROVIDER = "anthropic";
    await expect(load()).rejects.toThrow(/ANTHROPIC_API_KEY, AI_MODEL/);
    vi.resetModules();
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.AI_MODEL = "configured";
    process.env.AI_EFFORT = "low";
    const env = await load();
    expect([env.aiModel, env.aiEffort]).toEqual(["configured", "low"]);
    vi.resetModules();
    process.env.AI_EFFORT = "turbo";
    await expect(load()).rejects.toThrow(/AI_EFFORT/);
  });
});
