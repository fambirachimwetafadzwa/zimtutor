import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { embedChunks } from "../../src/ingestion/embed-chunks";
import { loadSnapshot } from "../../src/ingestion/load-db";
import { createLocalHashProvider } from "../../src/lib/ai/embeddings";
import { bestQuote, createRetriever } from "../../src/lib/tutor/retrieval";
import { loadSnapshot as readSnapshot } from "../ingestion/snapshot-fixture";
import { FixtureCurriculum } from "../tutor/learner";
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from "./harness";
import { PostgresSearchPort } from "./tutor-stores";

/**
 * Finding the syllabus text that answers a child's question, with the real retrieval functions, the
 * real pgvector index and the whole syllabus loaded.
 */

const snapshot = readSnapshot();

describe.skipIf(!TEST_DATABASE_URL)("tutor retrieval over the syllabus", () => {
  let db: TestDatabase;
  const curriculum = new FixtureCurriculum();
  const embeddings = createLocalHashProvider();

  beforeAll(async () => {
    db = await createTestDatabase();
    await loadSnapshot(db.sql, snapshot);
    await embedChunks(db.sql, embeddings, { batchSize: 100 });
  }, 120_000);
  afterAll(async () => db?.drop());

  const ask = async (goal: string, message: string) => {
    const facts = (await curriculum.facts(goal))!;
    const retriever = createRetriever(new PostgresSearchPort(db.sql), embeddings);
    return { facts, passages: await retriever.passages({ message, objective: facts }) };
  };

  const chunkRows = async (ids: string[]) =>
    db.sql<Array<{ chunk_key: string; grade: number; topic: string }>>`
      select chunk_key, grade, topic from public.curriculum_chunks where chunk_key in ${db.sql(ids)}`;

  it("finds the syllabus line a child is asking about, within this grade and topic only", async () => {
    const { passages } = await ask("G5-OPS-ADDITION-WHOLE-NUMBERS-001", "why do we carry the one?");
    expect(passages.length).toBeGreaterThan(0);
    expect(passages.length).toBeLessThanOrEqual(3);
    // the goal's own text is among them
    expect(passages.map((p) => p.id)).toContain("obj:G5-OPS-ADDITION-WHOLE-NUMBERS-001");
    // nothing from another grade or another topic
    for (const row of await chunkRows(passages.map((p) => p.id))) {
      expect(row.grade, row.chunk_key).toBe(5);
      expect(row.topic, row.chunk_key).toBe("Operations");
    }
    const quote = bestQuote(passages, "why do we carry the one?");
    expect(quote?.line.toLowerCase()).toContain("carry");
    expect(quote?.passage.page).toBeGreaterThan(0);
  });

  it("never answers a Grade 3 child from Grade 5 or 7 material", async () => {
    const { passages } = await ask(
      "G3-OPS-ADDITION-WHOLE-NUMBERS-001",
      "what is adding with carrying",
    );
    expect(passages.length).toBeGreaterThan(0);
    for (const row of await chunkRows(passages.map((p) => p.id)))
      expect(row.grade, row.chunk_key).toBe(3);
  });

  it("finds fractions vocabulary under Number, not under Operations", async () => {
    const { passages } = await ask(
      "G5-NUM-PROPER-FRACTIONS-004",
      "what is a numerator and a denominator",
    );
    for (const row of await chunkRows(passages.map((p) => p.id))) {
      expect(row.grade).toBe(5);
      expect(row.topic).toBe("Number");
    }
  });

  it("still returns the goal's own text for a question the syllabus does not mention", async () => {
    const { passages } = await ask(
      "G5-OPS-ADDITION-WHOLE-NUMBERS-001",
      "tell me a joke about elephants",
    );
    expect(passages.map((p) => p.id)).toContain("obj:G5-OPS-ADDITION-WHOLE-NUMBERS-001");
    expect(bestQuote(passages, "tell me a joke about elephants")).toBeNull();
  });

  it("treats odd characters in a question as plain words", async () => {
    const { passages } = await ask(
      "G5-OPS-ADDITION-WHOLE-NUMBERS-001",
      `carry'); drop table public.curriculum_chunks; -- & | ! ( ) :*`,
    );
    expect(passages.length).toBeGreaterThan(0);
    const [row] = await db.sql<
      Array<{ n: number }>
    >`select count(*)::int as n from public.curriculum_chunks`;
    expect(row!.n).toBeGreaterThan(400);
  });
});
