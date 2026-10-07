import { describe, expect, it, vi } from "vitest";
import {
  createLocalHashProvider,
  createOpenAiCompatibleProvider,
  EMBEDDING_DIMENSIONS,
  EmbeddingError,
  embeddingProviderFromEnv,
  localHashEmbedding,
  tokenize,
  toVectorLiteral,
} from "../../src/lib/ai/embeddings";

const cosine = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i]!, 0);
const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

describe("tokenize", () => {
  it("lower-cases, drops stop words and applies light stemming", () => {
    expect(tokenize("Comparing the Fractions of Proper denominators")).toEqual([
      "compar",
      "fraction",
      "proper",
      "denominator",
    ]);
  });
  it("keeps numbers whole", () => {
    expect(tokenize("0 to 100 000")).toEqual(["0", "100", "000"]);
  });
});

describe("local-hash embeddings", () => {
  it("returns a finite, unit-length, 1536-dimensional vector", () => {
    const v = localHashEmbedding("compare fractions with different denominators");
    expect(v).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(v.every(Number.isFinite)).toBe(true);
    expect(norm(v)).toBeCloseTo(1, 4);
  });

  it("is deterministic", () => {
    expect(localHashEmbedding("area of a rectangle")).toEqual(
      localHashEmbedding("area of a rectangle"),
    );
  });

  it("ranks lexically related text above unrelated text", () => {
    const query = localHashEmbedding("compare fractions");
    const related = localHashEmbedding("Objective: compare fractions with the same denominator");
    const unrelated = localHashEmbedding("Objective: measure the mass of objects in kilograms");
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated) + 0.2);
  });

  it("treats word forms alike (fraction/fractions, comparing/compare)", () => {
    expect(
      cosine(localHashEmbedding("comparing fractions"), localHashEmbedding("compare fraction")),
    ).toBeGreaterThan(0.9);
  });

  it("returns a defined unit vector even for empty text (cosine distance must never be NaN)", () => {
    const v = localHashEmbedding("   ");
    expect(norm(v)).toBeCloseTo(1, 6);
  });

  it("is exposed as a provider labelled with its own vector space", async () => {
    const provider = createLocalHashProvider();
    expect(provider.model).toBe("local-hash-v1");
    expect(await provider.embed(["a", "b"])).toHaveLength(2);
  });

  it("formats a pgvector literal", () => {
    expect(toVectorLiteral([0.5, -1, 0])).toBe("[0.5,-1,0]");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const vec = (fill = 0.1) => new Array<number>(EMBEDDING_DIMENSIONS).fill(fill);

describe("openai-compatible provider", () => {
  const base = {
    baseUrl: "https://embed.example.test/v1/",
    apiKey: "sk-secret",
    model: "text-embedding-3-small",
    sleep: async () => {},
  };

  it("posts to {base}/embeddings with bearer auth, asks for 1536 dimensions, and returns vectors in input order", async () => {
    const fetchMock = vi.fn(async () =>
      // deliberately out of order: the provider must sort by index
      jsonResponse({
        data: [
          { index: 1, embedding: vec(0.2) },
          { index: 0, embedding: vec(0.1) },
        ],
      }),
    );
    const provider = createOpenAiCompatibleProvider({
      ...base,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const out = await provider.embed(["first", "second"]);
    expect(out[0]![0]).toBe(0.1);
    expect(out[1]![0]).toBe(0.2);
    expect(provider.model).toBe("openai-compatible:text-embedding-3-small");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://embed.example.test/v1/embeddings");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-secret");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "text-embedding-3-small",
      input: ["first", "second"],
      dimensions: 1536,
    });
  });

  it("does not send `dimensions` to models that do not accept it, and works without an API key", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ index: 0, embedding: vec() }] }));
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://localhost:11434/v1",
      model: "nomic-embed",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await provider.embed(["x"]);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ model: "nomic-embed", input: ["x"] });
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("splits large inputs into batches", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const n = (JSON.parse(init.body as string) as { input: string[] }).input.length;
      return jsonResponse({
        data: Array.from({ length: n }, (_, index) => ({ index, embedding: vec() })),
      });
    });
    const provider = createOpenAiCompatibleProvider({
      ...base,
      batchSize: 2,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const out = await provider.embed(["a", "b", "c", "d", "e"]);
    expect(out).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries rate limits and server errors with backoff, then succeeds", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    let calls = 0;
    const fetchMock = vi.fn(async () =>
      ++calls < 3
        ? jsonResponse({}, calls === 1 ? 429 : 503)
        : jsonResponse({ data: [{ index: 0, embedding: vec() }] }),
    );
    const provider = createOpenAiCompatibleProvider({
      ...base,
      sleep,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await provider.embed(["x"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });

  it("gives up after the configured retries", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 500));
    const provider = createOpenAiCompatibleProvider({
      ...base,
      maxRetries: 2,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(provider.embed(["x"])).rejects.toThrow(/kept failing \(HTTP 500\)/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry client errors, and never leaks the API key in the message", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "invalid model" }, 400));
    const provider = createOpenAiCompatibleProvider({
      ...base,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const error = await provider.embed(["x"]).catch((e: Error) => e);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as Error).message).toContain("HTTP 400");
    expect((error as Error).message).not.toContain("sk-secret");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries network failures", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      if (++calls === 1) throw new TypeError("fetch failed");
      return jsonResponse({ data: [{ index: 0, embedding: vec() }] });
    });
    const provider = createOpenAiCompatibleProvider({
      ...base,
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(await provider.embed(["x"])).toHaveLength(1);
  });

  it("rejects vectors of the wrong dimension with an actionable message", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }),
    );
    const provider = createOpenAiCompatibleProvider({
      ...base,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(provider.embed(["x"])).rejects.toThrow(/3-dimensional.*1536/);
  });

  it("rejects a response with the wrong number of vectors or a malformed body", async () => {
    const few = createOpenAiCompatibleProvider({
      ...base,
      fetch: (async () => jsonResponse({ data: [] })) as unknown as typeof fetch,
    });
    await expect(few.embed(["x"])).rejects.toThrow(/Asked for 1 embeddings but received 0/);
    const odd = createOpenAiCompatibleProvider({
      ...base,
      fetch: (async () => jsonResponse({ nope: true })) as unknown as typeof fetch,
    });
    await expect(odd.embed(["x"])).rejects.toThrow(/unexpected response shape/);
  });
});

describe("embeddingProviderFromEnv", () => {
  it("defaults to the offline local-hash provider", () => {
    expect(embeddingProviderFromEnv({}).model).toBe("local-hash-v1");
    expect(embeddingProviderFromEnv({ EMBEDDING_PROVIDER: "" }).model).toBe("local-hash-v1");
  });

  it("builds the openai-compatible provider from environment variables", () => {
    const provider = embeddingProviderFromEnv({
      EMBEDDING_PROVIDER: "openai-compatible",
      EMBEDDING_BASE_URL: "https://api.openai.com/v1",
      EMBEDDING_API_KEY: "k",
      EMBEDDING_MODEL: "text-embedding-3-small",
    });
    expect(provider.model).toBe("openai-compatible:text-embedding-3-small");
  });

  it("explains what is missing or invalid", () => {
    expect(() => embeddingProviderFromEnv({ EMBEDDING_PROVIDER: "openai-compatible" })).toThrow(
      /EMBEDDING_BASE_URL/,
    );
    expect(() => embeddingProviderFromEnv({ EMBEDDING_PROVIDER: "magic" })).toThrow(
      /Invalid embedding configuration/,
    );
  });
});
