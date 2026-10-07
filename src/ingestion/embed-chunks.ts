import {
  EMBEDDING_DIMENSIONS,
  EmbeddingError,
  toVectorLiteral,
  type EmbeddingProvider,
} from "../lib/ai/embeddings";
import type { Db } from "../lib/db/types";

/**
 * Embed curriculum chunks (the vector half of retrieval).
 *
 * Which chunks need a vector?
 *  - those without one (new, or their text changed — the loader discards the old vector);
 *  - those embedded by a DIFFERENT model than the provider's (vector spaces are not comparable);
 *  - everything, with `force`.
 *
 * Idempotent and resumable: each batch is one atomic UPDATE, so an interrupted run keeps what it
 * finished and the next run continues. A batch whose chunk text changed while it was being embedded
 * is not written (content_hash guard) and is picked up by the next run.
 */

export interface EmbedOptions {
  force?: boolean;
  batchSize?: number;
  log?: (message: string) => void;
}

export interface EmbedReport {
  model: string;
  /** Chunks that needed a vector. */
  pending: number;
  embedded: number;
  /** Changed while being embedded; left for the next run. */
  skippedChanged: number;
}

interface PendingChunk {
  id: string;
  content: string;
  content_hash: string;
}

export async function embedChunks(
  db: Db,
  provider: EmbeddingProvider,
  options: EmbedOptions = {},
): Promise<EmbedReport> {
  const log = options.log ?? (() => {});
  const batchSize = Math.max(1, options.batchSize ?? 32);

  const pending = options.force
    ? await db<
        PendingChunk[]
      >`select id, content, content_hash from public.curriculum_chunks order by chunk_key`
    : await db<PendingChunk[]>`
        select id, content, content_hash from public.curriculum_chunks
        where embedding is null or embedding_model is distinct from ${provider.model}
        order by chunk_key`;

  const report: EmbedReport = {
    model: provider.model,
    pending: pending.length,
    embedded: 0,
    skippedChanged: 0,
  };
  log(`${pending.length} chunk(s) to embed with ${provider.model}`);

  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    const vectors = await provider.embed(batch.map((c) => c.content));
    if (vectors.length !== batch.length) {
      throw new EmbeddingError(
        `Provider returned ${vectors.length} vectors for ${batch.length} chunks.`,
      );
    }
    for (const vector of vectors) {
      if (vector.length !== EMBEDDING_DIMENSIONS || !vector.every(Number.isFinite)) {
        throw new EmbeddingError(
          `Provider returned an invalid vector (length ${vector.length}); expected ${EMBEDDING_DIMENSIONS} finite numbers.`,
        );
      }
    }

    const params: unknown[] = [provider.model];
    const tuples = batch.map((chunk, i) => {
      params.push(chunk.id, chunk.content_hash, toVectorLiteral(vectors[i]!));
      const n = params.length;
      return `($${n - 2}::uuid, $${n - 1}::text, $${n}::text)`;
    });
    const result = await db.unsafe(
      `update public.curriculum_chunks c
          set embedding = v.embedding::extensions.vector, embedding_model = $1, embedded_at = now()
         from (values ${tuples.join(", ")}) as v(id, content_hash, embedding)
        where c.id = v.id and c.content_hash = v.content_hash`,
      params as never[],
    );
    report.embedded += result.count;
    report.skippedChanged += batch.length - result.count;
    log(`  embedded ${Math.min(start + batch.length, pending.length)}/${pending.length}`);
  }
  return report;
}
