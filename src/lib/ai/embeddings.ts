import { z } from "zod";

/**
 * Embedding providers for curriculum RAG.
 *
 * The database column is vector(1536), so every provider must return 1536-dimensional vectors. The
 * `model` string is stored beside each vector (curriculum_chunks.embedding_model): vectors from
 * different models live in different spaces and must never be compared, so the embed command
 * re-embeds everything whenever the configured model changes.
 *
 * Only OFFICIAL SYLLABUS TEXT is ever sent to a provider — never anything a learner typed at
 * indexing time. (At query time the retrieval layer embeds the tutor's search phrase, which it
 * builds from the curriculum context, not from raw learner messages.)
 *
 * Deliberately free of `server-only`: the offline CLIs import this module too.
 */

export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingProvider {
  /** Identifies the vector space, e.g. "local-hash-v1" or "openai-compatible:text-embedding-3-small". */
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

// ── local-hash: deterministic, offline, dependency-free ───────────────────────────────────────
// A hashed bag-of-words (unigrams + bigrams, signed feature hashing) projected to 1536 dimensions
// and L2-normalised. It captures LEXICAL overlap, not meaning: good enough for development, tests
// and offline use, and it keeps hybrid retrieval working (the full-text search covers the rest).
// Production should use a neural model via the openai-compatible provider.

const STOP_WORDS = new Set(
  (
    "a an and are as at be but by for from has have in into is it its of on or such that the their then there these " +
    "they this to was were will with which who whom whose should shall can may must not no"
  ).split(" "),
);

export function tokenize(text: string): string[] {
  const words = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "" && !STOP_WORDS.has(w));
  return words.map(stem);
}

/** A deliberately light stemmer: "fractions"/"fraction", "comparing"/"compare", "denominators". */
function stem(word: string): string {
  if (word.length <= 3 || /^\d+$/.test(word)) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);
  if (word.endsWith("e") && word.length > 4) return word.slice(0, -1);
  return word;
}

function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function localHashEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) {
    counts.set(tokens[i]!, (counts.get(tokens[i]!) ?? 0) + 1);
    if (i + 1 < tokens.length) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`;
      counts.set(bigram, (counts.get(bigram) ?? 0) + 0.5);
    }
  }
  for (const [feature, count] of counts) {
    const index = fnv1a(feature, 0x811c9dc5) % EMBEDDING_DIMENSIONS;
    const sign = fnv1a(feature, 0x9747b28c) & 1 ? 1 : -1;
    vector[index] = vector[index]! + sign * (1 + Math.log(count));
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) {
    // Nothing to embed (empty text): a fixed unit vector, so cosine distance is always defined.
    vector[0] = 1;
    return vector;
  }
  return vector.map((x) => Math.round((x / norm) * 1e6) / 1e6);
}

export function createLocalHashProvider(): EmbeddingProvider {
  return { model: "local-hash-v1", embed: async (texts) => texts.map(localHashEmbedding) };
}

// ── openai-compatible: POST {baseUrl}/embeddings ──────────────────────────────────────────────

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  /** Optional: self-hosted servers (Ollama, vLLM) often need none. */
  apiKey?: string;
  model: string;
  batchSize?: number;
  maxRetries?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Injected in tests so retries do not really wait. */
  sleep?: (ms: number) => Promise<void>;
}

const embeddingResponseSchema = z.object({
  data: z.array(
    z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number()) }),
  ),
});

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): EmbeddingProvider {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/embeddings`;
  const doFetch = config.fetch ?? fetch;
  const sleep =
    config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const batchSize = config.batchSize ?? 64;
  const maxRetries = config.maxRetries ?? 3;
  // `dimensions` is how the text-embedding-3 family is asked for 1536 dims; other models reject it.
  const asksForDimensions = /^text-embedding-3/.test(config.model);

  async function embedBatch(texts: string[]): Promise<number[][]> {
    let attempt = 0;
    for (;;) {
      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            input: texts,
            ...(asksForDimensions ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
          }),
          signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
        });
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(500 * 2 ** attempt++);
          continue;
        }
        throw new EmbeddingError(
          `The embedding service could not be reached: ${(error as Error).message}`,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(500 * 2 ** attempt++);
          continue;
        }
        throw new EmbeddingError(
          `The embedding service kept failing (HTTP ${response.status}) after ${maxRetries} retries.`,
        );
      }
      if (!response.ok) {
        // Never echo the response body into logs verbatim beyond a short excerpt; it is not secret, but may be large.
        const body = (await response.text().catch(() => "")).slice(0, 300);
        throw new EmbeddingError(
          `The embedding service rejected the request (HTTP ${response.status}): ${body}`,
        );
      }
      const parsed = embeddingResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success)
        throw new EmbeddingError("The embedding service returned an unexpected response shape.");
      const ordered = [...parsed.data.data]
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
      if (ordered.length !== texts.length) {
        throw new EmbeddingError(
          `Asked for ${texts.length} embeddings but received ${ordered.length}.`,
        );
      }
      for (const vector of ordered) {
        if (vector.length !== EMBEDDING_DIMENSIONS) {
          throw new EmbeddingError(
            `Model "${config.model}" returned ${vector.length}-dimensional vectors; the database column is ${EMBEDDING_DIMENSIONS}. ` +
              "Choose a model that supports 1536 dimensions (e.g. text-embedding-3-small) or change the column.",
          );
        }
        if (!vector.every(Number.isFinite))
          throw new EmbeddingError("The embedding service returned a non-finite number.");
      }
      return ordered;
    }
  }

  return {
    model: `openai-compatible:${config.model}`,
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize)
        out.push(...(await embedBatch(texts.slice(i, i + batchSize))));
      return out;
    },
  };
}

// ── configuration ─────────────────────────────────────────────────────────────────────────────

const embeddingEnvSchema = z.object({
  EMBEDDING_PROVIDER: z.enum(["local-hash", "openai-compatible"]).default("local-hash"),
  EMBEDDING_MODEL: z.string().trim().min(1).default("text-embedding-3-small"),
  EMBEDDING_BASE_URL: z.string().trim().optional(),
  EMBEDDING_API_KEY: z.string().trim().optional(),
});

export function embeddingProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): EmbeddingProvider {
  const parsed = embeddingEnvSchema.safeParse({
    EMBEDDING_PROVIDER: env.EMBEDDING_PROVIDER || undefined,
    EMBEDDING_MODEL: env.EMBEDDING_MODEL || undefined,
    EMBEDDING_BASE_URL: env.EMBEDDING_BASE_URL || undefined,
    EMBEDDING_API_KEY: env.EMBEDDING_API_KEY || undefined,
  });
  if (!parsed.success) {
    throw new EmbeddingError(
      `Invalid embedding configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  const config = parsed.data;
  if (config.EMBEDDING_PROVIDER === "local-hash") return createLocalHashProvider();
  if (!config.EMBEDDING_BASE_URL) {
    throw new EmbeddingError(
      "EMBEDDING_PROVIDER=openai-compatible needs EMBEDDING_BASE_URL (e.g. https://api.openai.com/v1).",
    );
  }
  return createOpenAiCompatibleProvider({
    baseUrl: config.EMBEDDING_BASE_URL,
    apiKey: config.EMBEDDING_API_KEY,
    model: config.EMBEDDING_MODEL,
  });
}

/** pgvector text literal: "[0.1,0.2,…]". */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
