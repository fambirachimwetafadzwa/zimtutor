import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from "./harness";
import { HASH, seedMiniCurriculum, seedUsers, type TestUsers } from "./fixtures";

const DIMS = 1536;

/** A unit vector with a single 1 at `index` — cosine similarity between two is 1 if equal else 0. */
function oneHot(index: number): string {
  const v = new Array<number>(DIMS).fill(0);
  v[index] = 1;
  return `[${v.join(",")}]`;
}

describe.skipIf(!TEST_DATABASE_URL)("RAG retrieval functions", () => {
  let db: TestDatabase;
  let u: TestUsers;

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedMiniCurriculum(db.sql);
    u = await seedUsers(db.sql);

    const chunks = [
      {
        key: "obj:1",
        grade: 3,
        topic: "number",
        code: "NUM",
        sub: "place value of digits",
        subId: "G3-NUM-PLACE-VALUE",
        obj: "G3-NUM-PLACE-VALUE-001",
        text: "Identify the place value of each digit using an abacus",
        vec: 0,
      },
      {
        key: "obj:2",
        grade: 3,
        topic: "number",
        code: "NUM",
        sub: "place value of digits",
        subId: "G3-NUM-PLACE-VALUE",
        obj: "G3-NUM-PLACE-VALUE-002",
        text: "Compare place value of digits in different numbers",
        vec: 1,
      },
      {
        key: "obj:3",
        grade: 4,
        topic: "number",
        code: "NUM",
        sub: "place value of digits",
        subId: "G4-NUM-PLACE-VALUE",
        obj: "G4-NUM-PLACE-VALUE-001",
        text: "Place value of digits up to ten thousand with number strips",
        vec: 2,
      },
    ];
    for (const c of chunks) {
      await db.sql`
        insert into public.curriculum_chunks
          (document_id, chunk_key, section_type, page, grade, subject, topic, topic_code, subtopic, subtopic_id,
           learning_objective_id, content, content_hash, source_title, curriculum_year, embedding, embedding_model)
        values ('doc-1', ${c.key}, 'COMPETENCY_OBJECTIVE', 5, ${c.grade}, 'mathematics', ${c.topic}, ${c.code}, ${c.sub}, ${c.subId},
                ${c.obj}, ${c.text}, ${HASH}, 'Test Syllabus', '2024-2030', ${oneHot(c.vec)}::extensions.vector, 'test-model')`;
    }
    // A chunk with no embedding yet (e.g. before `curriculum:embed` has run).
    await db.sql`
      insert into public.curriculum_chunks (document_id, chunk_key, section_type, page, grade, subject, topic, content, content_hash, source_title, curriculum_year)
      values ('doc-1', 'page:9', 'ASSESSMENT', 9, null, 'mathematics', null, 'Summative assessment is eighty percent', ${HASH}, 'Test Syllabus', '2024-2030')`;
  });
  afterAll(async () => {
    await db?.drop();
  });

  it("ranks by cosine similarity and reports it", async () => {
    await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
      const rows =
        await tx`select chunk_key, similarity from public.match_curriculum_chunks(${oneHot(1)}::extensions.vector, 3)`;
      expect(rows[0]).toMatchObject({ chunk_key: "obj:2" });
      expect(Number(rows[0]!.similarity)).toBeCloseTo(1, 5);
      expect(Number(rows[1]!.similarity)).toBeCloseTo(0, 5);
    });
  });

  it("applies metadata filters BEFORE ranking (grade, subject, topic, subtopic, objective)", async () => {
    await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
      // The best global match for this query is obj:3 (grade 4); a grade-3 filter must exclude it.
      const g3 =
        await tx`select chunk_key from public.match_curriculum_chunks(${oneHot(2)}::extensions.vector, 5, 3::smallint)`;
      expect(g3.map((r) => r.chunk_key).sort()).toEqual(["obj:1", "obj:2"]);

      const g4 =
        await tx`select chunk_key from public.match_curriculum_chunks(${oneHot(0)}::extensions.vector, 5, 4::smallint)`;
      expect(g4.map((r) => r.chunk_key)).toEqual(["obj:3"]);

      const bySubtopic = await tx`select chunk_key from public.match_curriculum_chunks(
        ${oneHot(0)}::extensions.vector, 5, null, 'Mathematics', 'NUMBER', 'Place Value Of Digits')`;
      expect(bySubtopic).toHaveLength(3); // filters are case-insensitive

      const byObjective = await tx`select chunk_key from public.match_curriculum_chunks(
        ${oneHot(0)}::extensions.vector, 5, null, null, null, null, 'G3-NUM-PLACE-VALUE-002')`;
      expect(byObjective.map((r) => r.chunk_key)).toEqual(["obj:2"]);

      const none =
        await tx`select chunk_key from public.match_curriculum_chunks(${oneHot(0)}::extensions.vector, 5, 5::smallint)`;
      expect(none).toHaveLength(0);
    });
  });

  it("honours the similarity floor and ignores chunks that have no embedding yet", async () => {
    await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
      const strict =
        await tx`select chunk_key from public.match_curriculum_chunks(${oneHot(0)}::extensions.vector, 10, null, null, null, null, null, 0.5)`;
      expect(strict.map((r) => r.chunk_key)).toEqual(["obj:1"]);
      const all =
        await tx`select chunk_key from public.match_curriculum_chunks(${oneHot(0)}::extensions.vector, 10)`;
      expect(all.map((r) => r.chunk_key)).not.toContain("page:9");
    });
  });

  it("caps the number of results", async () => {
    await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
      const rows =
        await tx`select chunk_key from public.match_curriculum_chunks(${oneHot(0)}::extensions.vector, 1)`;
      expect(rows).toHaveLength(1);
    });
  });

  it("supports full-text search with the same filters (works before embeddings exist)", async () => {
    await asUser(db.sql, { userId: u.learnerA }, async (tx) => {
      const hits =
        await tx`select chunk_key from public.search_curriculum_chunks_text('abacus place value')`;
      expect(hits.map((r) => r.chunk_key)).toEqual(["obj:1"]);

      const assess =
        await tx`select chunk_key from public.search_curriculum_chunks_text('summative assessment')`;
      expect(assess.map((r) => r.chunk_key)).toEqual(["page:9"]);

      const filtered =
        await tx`select chunk_key from public.search_curriculum_chunks_text('place value', 10, 4::smallint)`;
      expect(filtered.map((r) => r.chunk_key)).toEqual(["obj:3"]);
    });
  });

  it("is not callable by anonymous visitors", async () => {
    await asUser(db.sql, "anon", async (tx) => {
      await expect(
        tx`select * from public.search_curriculum_chunks_text('place value')`,
      ).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  it("rejects chunks that are not official, and embeddings without a model name", async () => {
    await expect(
      db.sql`insert into public.curriculum_chunks (document_id, chunk_key, section_type, page, content, content_hash, source_title, curriculum_year, source_type)
             values ('doc-1', 'x', 'PREAMBLE', 1, 'c', 'h', 't', 'y', 'AI_GENERATED')`,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.sql`insert into public.curriculum_chunks (document_id, chunk_key, section_type, page, content, content_hash, source_title, curriculum_year, embedding)
             values ('doc-1', 'y', 'PREAMBLE', 1, 'c', 'h', 't', 'y', ${oneHot(0)}::extensions.vector)`,
    ).rejects.toMatchObject({ code: "23514" });
  });
});
