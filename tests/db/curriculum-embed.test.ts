import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditCurriculum } from "../../src/ingestion/audit";
import { embedChunks } from "../../src/ingestion/embed-chunks";
import { textHash } from "../../src/ingestion/ids";
import { loadSnapshot } from "../../src/ingestion/load-db";
import {
  createLocalHashProvider,
  EmbeddingError,
  localHashEmbedding,
  toVectorLiteral,
  type EmbeddingProvider,
} from "../../src/lib/ai/embeddings";
import { cloneSnapshot, loadSnapshot as readSnapshot } from "../ingestion/snapshot-fixture";
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from "./harness";

const snapshot = readSnapshot();

describe.skipIf(!TEST_DATABASE_URL)("embedding the curriculum chunks (real pgvector)", () => {
  let db: TestDatabase;
  const provider = createLocalHashProvider();

  beforeAll(async () => {
    db = await createTestDatabase();
    await loadSnapshot(db.sql, snapshot);
  });
  afterAll(async () => db?.drop());

  const embeddedCount = async (model?: string) => {
    const [row] = await db.sql`select count(*)::int as n from public.curriculum_chunks
                               where embedding is not null ${model ? db.sql`and embedding_model = ${model}` : db.sql``}`;
    return row!.n as number;
  };
  const totalChunks = async () =>
    (await db.sql`select count(*)::int as n from public.curriculum_chunks`)[0]!.n as number;

  it("embeds every chunk, labels the vector space, and satisfies the audit that requires embeddings", async () => {
    const total = await totalChunks();
    expect(await embeddedCount()).toBe(0);
    const report = await embedChunks(db.sql, provider, { batchSize: 50 });
    expect(report).toMatchObject({
      model: "local-hash-v1",
      pending: total,
      embedded: total,
      skippedChanged: 0,
    });
    expect(await embeddedCount("local-hash-v1")).toBe(total);
    const findings = await auditCurriculum(db.sql, {
      snapshot,
      requireEmbeddings: true,
      expectedEmbeddingModel: "local-hash-v1",
    });
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(findings.map((f) => f.code)).not.toContain("CHUNK_NOT_EMBEDDED");
  });

  it("is idempotent: a second run has nothing to do", async () => {
    const report = await embedChunks(db.sql, provider);
    expect(report).toMatchObject({ pending: 0, embedded: 0 });
  });

  it("retrieves the exact objective by vector similarity inside a metadata filter", async () => {
    const query = toVectorLiteral(localHashEmbedding("compare fractions"));
    const hits = await db.sql`
      select learning_objective_id, grade, topic, subtopic, similarity
      from public.match_curriculum_chunks(${query}::extensions.vector, 5, 5::smallint, 'mathematics', 'number', 'proper fractions')`;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({
      learning_objective_id: "G5-NUM-PROPER-FRACTIONS-004",
      grade: 5,
      topic: "Number",
    });
    for (const hit of hits)
      expect(hit).toMatchObject({ grade: 5, topic: "Number", subtopic: "Proper Fractions" });

    const exact = await db.sql`
      select learning_objective_id from public.match_curriculum_chunks(${query}::extensions.vector, 5, null, null, null, null, 'G6-MEA-MASS-001')`;
    expect(exact.map((r) => r.learning_objective_id)).toEqual(["G6-MEA-MASS-001"]);
  });

  it("re-embeds everything when the embedding model changes (vector spaces are not comparable)", async () => {
    const other: EmbeddingProvider = {
      model: "other-model",
      embed: async (texts) => texts.map(localHashEmbedding),
    };
    const total = await totalChunks();
    const report = await embedChunks(db.sql, other);
    expect(report.embedded).toBe(total);
    expect(await embeddedCount("other-model")).toBe(total);
    expect(await embeddedCount("local-hash-v1")).toBe(0);
    const stale = await auditCurriculum(db.sql, { expectedEmbeddingModel: "local-hash-v1" });
    expect(stale.map((f) => f.code)).toContain("EMBEDDING_MODEL_CHANGED");
    await embedChunks(db.sql, provider); // back to the default for the remaining tests
    expect(await embeddedCount("local-hash-v1")).toBe(total);
  });

  it("only re-embeds the chunks whose text changed after a re-ingest", async () => {
    const target = snapshot.objectives[20]!;
    const edited = cloneSnapshot();
    const text = `${target.text} (clarified)`;
    edited.objectives[20] = { ...edited.objectives[20]!, text, text_hash: textHash(text) };
    await loadSnapshot(db.sql, edited, { acceptChanges: true });
    expect(await totalChunks()).toBe((await embeddedCount()) + 1);
    const report = await embedChunks(db.sql, provider);
    expect(report).toMatchObject({ pending: 1, embedded: 1 });
    await loadSnapshot(db.sql, snapshot, { acceptChanges: true }); // restore the original wording
    expect((await embedChunks(db.sql, provider)).embedded).toBe(1);
  });

  it("force re-embeds all chunks", async () => {
    const total = await totalChunks();
    expect((await embedChunks(db.sql, provider, { force: true })).embedded).toBe(total);
  });

  it("writes nothing from a batch whose chunk text changed while it was being embedded", async () => {
    await db.sql`update public.curriculum_chunks set embedding = null, embedding_model = null, embedded_at = null
                 where chunk_key = 'obj:G5-NUM-PROPER-FRACTIONS-004'`;
    const racing: EmbeddingProvider = {
      model: "local-hash-v1",
      async embed(texts) {
        // Someone edits the chunk after it was selected but before the vector is stored.
        await db.sql`update public.curriculum_chunks set content = content || ' (edited)',
                       content_hash = encode(sha256(convert_to(content || ' (edited)', 'UTF8')), 'hex')
                     where chunk_key = 'obj:G5-NUM-PROPER-FRACTIONS-004'`;
        return texts.map(localHashEmbedding);
      },
    };
    const report = await embedChunks(db.sql, racing);
    expect(report).toMatchObject({ pending: 1, embedded: 0, skippedChanged: 1 });
    const [chunk] =
      await db.sql`select embedding is null as missing from public.curriculum_chunks where chunk_key = 'obj:G5-NUM-PROPER-FRACTIONS-004'`;
    expect(chunk!.missing).toBe(true);
    await loadSnapshot(db.sql, snapshot); // the loader restores the chunk text (hash differs → rewritten)
    expect((await embedChunks(db.sql, provider)).embedded).toBe(1);
  });

  it("refuses a provider that returns vectors of the wrong size, writing nothing", async () => {
    await db.sql`update public.curriculum_chunks set embedding = null, embedding_model = null, embedded_at = null where chunk_key like 'obj:G3-%'`;
    const broken: EmbeddingProvider = {
      model: "broken",
      embed: async (texts) => texts.map(() => [1, 2, 3]),
    };
    await expect(embedChunks(db.sql, broken)).rejects.toBeInstanceOf(EmbeddingError);
    expect(await embeddedCount("broken")).toBe(0);
    await embedChunks(db.sql, provider);
  });
});
