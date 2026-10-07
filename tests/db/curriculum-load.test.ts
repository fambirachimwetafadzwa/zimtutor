import type { TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditCurriculum,
  CurriculumAuditError,
  type AuditFinding,
} from "../../src/ingestion/audit";
import { buildChunks } from "../../src/ingestion/chunks";
import { textHash } from "../../src/ingestion/ids";
import {
  CurriculumChangeError,
  InvalidSnapshotError,
  loadSnapshot,
  type LoadReport,
} from "../../src/ingestion/load-db";
import type { CurriculumSnapshot } from "../../src/ingestion/snapshot";
import { cloneSnapshot, loadSnapshot as readSnapshot } from "../ingestion/snapshot-fixture";
import { seedUsers } from "./fixtures";
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from "./harness";

/**
 * The curriculum loader against a REAL PostgreSQL + pgvector database with every migration applied:
 * the full syllabus (444 objectives) goes in through the same code path as `npm run curriculum:load`.
 */

const snapshot = readSnapshot();
const vector = (index: number) =>
  `[${Array.from({ length: 1536 }, (_, i) => (i === index ? 1 : 0)).join(",")}]`;

const count = async (db: TestDatabase, table: string) => {
  const [row] = await db.sql.unsafe<Array<{ n: number }>>(
    `select count(*)::int as n from public.${table}`,
  );
  return row!.n;
};

const errors = (findings: AuditFinding[]) => findings.filter((f) => f.severity === "error");

async function freshlyLoaded(): Promise<{ db: TestDatabase; report: LoadReport }> {
  const db = await createTestDatabase();
  const report = await loadSnapshot(db.sql, snapshot);
  return { db, report };
}

/** A VALID snapshot with one fewer objective: the last objective of a sub-topic whose last row keeps others. */
function withoutALeafObjective(): { snap: CurriculumSnapshot; removed: string } {
  const snap = cloneSnapshot();
  for (const sub of snap.subtopics) {
    const objectives = snap.objectives.filter((o) => o.subtopic_id === sub.id);
    const last = objectives.at(-1);
    if (!last) continue;
    const row = objectives.filter((o) => o.competency_row_id === last.competency_row_id);
    if (row.length >= 2 && last.ordinal_in_row === row.length) {
      snap.objectives = snap.objectives.filter((o) => o.id !== last.id);
      return { snap, removed: last.id };
    }
  }
  throw new Error("no suitable objective found");
}

describe.skipIf(!TEST_DATABASE_URL)("loading the real syllabus", () => {
  let db: TestDatabase;
  let report: LoadReport;

  beforeAll(async () => {
    ({ db, report } = await freshlyLoaded());
  });
  afterAll(async () => db?.drop());

  it("loads every table with the counts the snapshot describes", async () => {
    const expected: Record<string, number> = {
      curriculum_documents: 1,
      curriculum_document_pages: 83,
      curricula: 1,
      grades: 5,
      subjects: 1,
      topics: 20,
      subtopics: snapshot.subtopics.length,
      competency_rows: snapshot.competency_rows.length,
      learning_objectives: snapshot.objectives.length,
      curriculum_content: snapshot.content.length,
      curriculum_activities: snapshot.activities.length,
      curriculum_resources: snapshot.resources.length,
      assessment_components: snapshot.assessment.components.length,
      assessment_papers: snapshot.assessment.papers.length,
      assessment_skill_bands: snapshot.assessment.skill_bands.length,
      assessment_objectives: snapshot.assessment.objectives.length,
      assessment_project_stages: snapshot.assessment.project_stages.length,
      curriculum_chunks: buildChunks(snapshot).length,
    };
    for (const [table, n] of Object.entries(expected))
      expect(await count(db, table), table).toBe(n);
    expect(snapshot.objectives).toHaveLength(444);
    expect(report.written["learning_objectives"]).toBe(444);
  });

  it("preserves the four official topic names for Grades 3 to 7", async () => {
    const rows =
      await db.sql`select grade_id, array_agg(name order by ordinal) as names from public.topics group by grade_id order by grade_id`;
    expect(rows.map((r) => r.grade_id)).toEqual(["G3", "G4", "G5", "G6", "G7"]);
    for (const r of rows)
      expect(r.names).toEqual(["Number", "Operations", "Measures", "Relationships"]);
  });

  it("makes the hierarchy navigable with provenance for every objective (Curriculum → Grade → Subject → Topic → Sub-topic → Objective)", async () => {
    const [row] =
      await db.sql`select * from public.v_objective_context where objective_id = 'G5-NUM-PROPER-FRACTIONS-004'`;
    expect(row).toMatchObject({
      objective_text: "compare fractions",
      grade: 5,
      subject_name: "Mathematics",
      topic_code: "NUM",
      topic_name: "Number",
      subtopic_short_name: "Proper Fractions",
      source_document_id: "mopse-junior-mathematics-2024-2030",
      source_title: "Revised Junior Mathematics Syllabus MoPSE 2024 - 2030",
      organisation: "Ministry of Primary and Secondary Education (MoPSE), Zimbabwe",
      curriculum_year: "2024-2030",
      source_type: "OFFICIAL_CURRICULUM",
      verification_status: "VERIFIED_FROM_SOURCE",
    });
    expect(row!.source_page).toBeGreaterThanOrEqual(17);
    expect(row!.source_text).toBe("compare fractions");
    const [gaps] = await db.sql`
      select count(*)::int as n from public.v_objective_context
      where source_page is null or source_page_label is null or btrim(source_text) = ''
         or source_type <> 'OFFICIAL_CURRICULUM' or verification_status <> 'VERIFIED_FROM_SOURCE'`;
    expect(gaps!.n).toBe(0);
  });

  it("recovers the original row relationships: an objective's content, activities and resources", async () => {
    const [row] =
      await db.sql`select competency_row_id from public.learning_objectives where id = 'G5-NUM-PROPER-FRACTIONS-004'`;
    const expectedContent = snapshot.content
      .filter((c) => c.competency_row_id === row!.competency_row_id)
      .map((c) => c.text);
    const viaView =
      await db.sql`select text from public.v_objective_content where objective_id = 'G5-NUM-PROPER-FRACTIONS-004' order by ordinal`;
    expect(viaView.map((r) => r.text)).toEqual(expectedContent);
    expect(expectedContent.length).toBeGreaterThan(0);
    expect(
      (
        await db.sql`select 1 from public.v_objective_activities where objective_id = 'G5-NUM-PROPER-FRACTIONS-004'`
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await db.sql`select 1 from public.v_objective_resources where objective_id = 'G5-NUM-PROPER-FRACTIONS-004'`
      ).length,
    ).toBeGreaterThan(0);
  });

  it("stores the assessment model as data: 20% SBCA + 80% summative, and the Grade 7 papers", async () => {
    const components =
      await db.sql`select id, weighting_percent::float as w from public.assessment_components order by id`;
    expect(Object.fromEntries(components.map((c) => [c.id, c.w]))).toEqual({ SA: 80, SBCA: 20 });
    const papers =
      await db.sql`select paper_number, marks, duration_minutes, structure from public.assessment_papers order by paper_number`;
    expect(papers.map((p) => [p.paper_number, p.marks, p.duration_minutes])).toEqual([
      [1, 40, 120],
      [2, 40, 120],
    ]);
    const [details] =
      await db.sql`select details from public.assessment_components where id = 'SBCA'`;
    expect(details!.details).toMatchObject({ projects_per_grade: 1, grade_with_two_projects: 7 });
  });

  it("passes its own integrity audit with no errors (only known source properties and un-embedded chunks warn)", async () => {
    const findings = await auditCurriculum(db.sql, { snapshot });
    expect(errors(findings)).toEqual([]);
    expect(findings.map((f) => f.code).sort()).toEqual(
      ["CHUNK_NOT_EMBEDDED", "DUPLICATE_OBJECTIVE_TEXT"].sort(),
    );
    expect(report.audit.map((f) => f.code).sort()).toEqual(
      ["CHUNK_NOT_EMBEDDED", "DUPLICATE_OBJECTIVE_TEXT"].sort(),
    );
  });

  it("supports metadata-filtered full-text retrieval of the exact objective (RAG context)", async () => {
    const hits = await db.sql`
      select learning_objective_id, page, grade, topic, subtopic, source_type
      from public.search_curriculum_chunks_text('compare fractions', 5, 5::smallint, 'mathematics', 'number', 'proper fractions')`;
    expect(hits[0]).toMatchObject({
      learning_objective_id: "G5-NUM-PROPER-FRACTIONS-004",
      grade: 5,
      topic: "Number",
      subtopic: "Proper Fractions",
      source_type: "OFFICIAL_CURRICULUM",
    });
    // The metadata filter really filters: every hit belongs to the requested grade and topic.
    const filtered = await db.sql`
      select grade, topic from public.search_curriculum_chunks_text('fractions', 50, 5::smallint, 'mathematics', 'number', null)`;
    expect(filtered.length).toBeGreaterThan(1);
    for (const row of filtered) expect(row).toMatchObject({ grade: 5, topic: "Number" });
  });

  it("is repeatable: loading the same snapshot again changes nothing", async () => {
    const before =
      await db.sql`select id, text_hash, retired_at from public.learning_objectives order by id`;
    const chunkBefore =
      await db.sql`select chunk_key, content_hash from public.curriculum_chunks order by chunk_key`;
    const again = await loadSnapshot(db.sql, snapshot);
    expect(again.plan).toMatchObject({
      added: [],
      revived: [],
      reworded: [],
      moved: [],
      retired: [],
      unchanged: 444,
    });
    expect(again.chunks).toMatchObject({ new: 0, changed: 0, removed: 0 });
    expect(
      await db.sql`select id, text_hash, retired_at from public.learning_objectives order by id`,
    ).toEqual(before);
    expect(
      await db.sql`select chunk_key, content_hash from public.curriculum_chunks order by chunk_key`,
    ).toEqual(chunkBefore);
    expect(await count(db, "learning_objectives")).toBe(444);
    expect(await count(db, "subtopics")).toBe(snapshot.subtopics.length);
  });

  it("keeps embeddings of unchanged chunks across a re-load", async () => {
    await db.sql`update public.curriculum_chunks set embedding = ${vector(7)}::extensions.vector, embedding_model = 'test-model',
                 embedded_at = now() where chunk_key = 'obj:G5-NUM-PROPER-FRACTIONS-004'`;
    await loadSnapshot(db.sql, snapshot);
    const [chunk] =
      await db.sql`select embedding_model, embedded_at from public.curriculum_chunks where chunk_key = 'obj:G5-NUM-PROPER-FRACTIONS-004'`;
    expect(chunk).toMatchObject({ embedding_model: "test-model" });
    expect(chunk!.embedded_at).not.toBeNull();
    await db.sql`update public.curriculum_chunks set embedding = null, embedding_model = null, embedded_at = null`;
  });

  it("a dry run reports the plan and writes nothing", async () => {
    const empty = await createTestDatabase();
    try {
      const dry = await loadSnapshot(empty.sql, snapshot, { dryRun: true });
      expect(dry.dryRun).toBe(true);
      expect(dry.plan.added).toHaveLength(444);
      expect(await count(empty, "curriculum_documents")).toBe(0);
      expect(await count(empty, "learning_objectives")).toBe(0);
    } finally {
      await empty.drop();
    }
  });
});

describe.skipIf(!TEST_DATABASE_URL)(
  "loading is refused, atomically, when the snapshot is unsound",
  () => {
    it("rejects an invalid snapshot before writing anything", async () => {
      const db = await createTestDatabase();
      try {
        const broken = cloneSnapshot();
        broken.objectives[0]!.competency_row_id = "G3-NUM-NOWHERE.R1";
        await expect(loadSnapshot(db.sql, broken)).rejects.toBeInstanceOf(InvalidSnapshotError);
        expect(await count(db, "curriculum_documents")).toBe(0);
      } finally {
        await db.drop();
      }
    });

    it("rolls the whole load back if the post-load audit finds an error", async () => {
      const { db } = await freshlyLoaded();
      try {
        // Damage the snapshot cannot reveal and the loader does not own: another document's leftover
        // sub-topic with no rows or objectives, sitting in an active topic.
        await db.sql`insert into public.curriculum_documents (id, title, organisation, curriculum_year, source_type, verification_status, sha256, page_count, extractor_version)
                   values ('other-doc', 'Other', 'Other', '2000', 'OFFICIAL_CURRICULUM', 'VERIFIED_FROM_SOURCE', ${"c".repeat(64)}, 10, 'test')`;
        await db.sql`insert into public.subtopics (id, topic_id, ordinal, name, short_name, slug, strand_key, source_document_id, source_page, source_page_label, source_text)
                   values ('G3-NUM-STRAY', 'G3-NUM', 99, 'Stray', 'Stray', 'STRAY', 'stray', 'other-doc', 5, '1', 'Stray')`;
        const edited = cloneSnapshot();
        edited.document.title = "A title that must not be committed";
        const attempt = loadSnapshot(db.sql, edited);
        await expect(attempt).rejects.toBeInstanceOf(CurriculumAuditError);
        await expect(attempt).rejects.toThrow(/SUBTOPIC_WITHOUT_ROWS/);
        const [doc] =
          await db.sql`select title from public.curriculum_documents where id = ${snapshot.document.id}`;
        expect(doc!.title).toBe(snapshot.document.title); // nothing from the failed load was kept
      } finally {
        await db.drop();
      }
    });
  },
);

describe.skipIf(!TEST_DATABASE_URL)("re-ingesting a changed curriculum", () => {
  it("refuses to reword an existing objective unless the change is accepted — and then updates its chunk and drops its embedding", async () => {
    const { db } = await freshlyLoaded();
    try {
      const target = snapshot.objectives[10]!;
      const reworded = cloneSnapshot();
      const newText = `${target.text} (reviewed)`;
      reworded.objectives[10] = {
        ...reworded.objectives[10]!,
        text: newText,
        text_hash: textHash(newText),
      };

      await db.sql`update public.curriculum_chunks set embedding = ${vector(3)}::extensions.vector, embedding_model = 'test-model', embedded_at = now()`;

      await expect(loadSnapshot(db.sql, reworded)).rejects.toBeInstanceOf(CurriculumChangeError);
      const [untouched] =
        await db.sql`select text, retired_at from public.learning_objectives where id = ${target.id}`;
      expect(untouched).toMatchObject({ text: target.text, retired_at: null });

      const accepted = await loadSnapshot(db.sql, reworded, { acceptChanges: true });
      expect(accepted.plan.reworded).toEqual([
        { id: target.id, before: target.text, after: newText },
      ]);
      const [row] =
        await db.sql`select text, text_hash from public.learning_objectives where id = ${target.id}`;
      expect(row).toEqual({ text: newText, text_hash: textHash(newText) });

      // Only the changed chunk lost its vector; the other chunks kept theirs.
      const chunks =
        await db.sql`select chunk_key, embedding is not null as embedded, content from public.curriculum_chunks`;
      const changed = chunks.find((c) => c.chunk_key === `obj:${target.id}`)!;
      expect(changed.embedded).toBe(false);
      expect(changed.content).toContain(newText);
      expect(chunks.filter((c) => c.embedded)).toHaveLength(chunks.length - 1);
      expect(errors(await auditCurriculum(db.sql, { snapshot: reworded }))).toEqual([]);
    } finally {
      await db.drop();
    }
  });

  it("refuses a different source PDF under the same document id", async () => {
    const { db } = await freshlyLoaded();
    try {
      const other = cloneSnapshot();
      other.document.sha256 = "b".repeat(64);
      await expect(loadSnapshot(db.sql, other)).rejects.toThrow(/checksum changed/);
      const accepted = await loadSnapshot(db.sql, other, { acceptChanges: true });
      expect(accepted.plan.sourceChanged).toBe(true);
      const [doc] = await db.sql`select sha256 from public.curriculum_documents`;
      expect(doc!.sha256).toBe("b".repeat(64));
    } finally {
      await db.drop();
    }
  });

  it("RETIRES an objective that left the syllabus instead of deleting it, so learner history survives", async () => {
    const { db } = await freshlyLoaded();
    try {
      const { snap, removed } = withoutALeafObjective();
      const users = await seedUsers(db.sql);
      await db.sql`insert into public.learner_objective_mastery (learner_id, objective_id, attempts, correct_attempts, incorrect_attempts, mastery_score)
                   values (${users.learnerA}, ${removed}, 4, 3, 1, 0.55)`;
      const [question] = await db.sql`
        insert into public.questions (learning_objective_id, grade, topic_code, subtopic_id, difficulty, question_type, stem, marking_method, source_type, generator, content_hash)
        select o.id, g.number, t.code, s.id, 1, 'NUMERIC', 'q', 'EXACT_NUMERIC', 'SUPPLEMENTAL', 'test', 'retire-q'
        from public.learning_objectives o join public.subtopics s on s.id = o.subtopic_id
        join public.topics t on t.id = s.topic_id join public.grades g on g.id = t.grade_id
        where o.id = ${removed} returning id`;

      await expect(loadSnapshot(db.sql, snap)).rejects.toThrow(/RETIRED/);
      expect(await count(db, "learning_objectives")).toBe(444);

      const report = await loadSnapshot(db.sql, snap, { acceptChanges: true });
      expect(report.plan.retired).toEqual([removed]);

      // Still there, flagged; mastery untouched; the question is no longer served; the chunk is gone.
      const [objective] =
        await db.sql`select retired_at from public.learning_objectives where id = ${removed}`;
      expect(objective!.retired_at).not.toBeNull();
      expect(await count(db, "learning_objectives")).toBe(444);
      const [mastery] =
        await db.sql`select attempts, mastery_score::float as score from public.learner_objective_mastery where objective_id = ${removed}`;
      expect(mastery).toEqual({ attempts: 4, score: 0.55 });
      const [q] = await db.sql`select status from public.questions where id = ${question!.id}`;
      expect(q!.status).toBe("RETIRED");
      expect(
        await db.sql`select 1 from public.curriculum_chunks where chunk_key = ${`obj:${removed}`}`,
      ).toHaveLength(0);
      expect(
        await db.sql`select 1 from public.curriculum_chunks where learning_objective_id = ${removed}`,
      ).toHaveLength(0);
      expect(errors(await auditCurriculum(db.sql, { snapshot: snap }))).toEqual([]);

      // Putting it back is a deliberate act too — and un-retires it with its history intact.
      await expect(loadSnapshot(db.sql, snapshot)).rejects.toThrow(/REVIVED/);
      const revived = await loadSnapshot(db.sql, snapshot, { acceptChanges: true });
      expect(revived.plan.revived).toEqual([removed]);
      const [back] =
        await db.sql`select retired_at from public.learning_objectives where id = ${removed}`;
      expect(back!.retired_at).toBeNull();
      expect(await count(db, "learner_objective_mastery")).toBe(1);
      expect(
        (await db.sql`select status from public.questions where id = ${question!.id}`)[0]!.status,
      ).toBe("RETIRED");
    } finally {
      await db.drop();
    }
  });

  it("lets sub-topics swap positions without tripping the ordering constraints", async () => {
    const { db } = await freshlyLoaded();
    try {
      const swapped = cloneSnapshot();
      const [a, b] = swapped.subtopics.filter((s) => s.topic_id === "G5-MEA").slice(0, 2);
      [a!.ordinal, b!.ordinal] = [b!.ordinal, a!.ordinal];
      const report = await loadSnapshot(db.sql, swapped);
      expect(report.plan.unchanged).toBe(444);
      const rows =
        await db.sql`select id, ordinal from public.subtopics where id in (${a!.id}, ${b!.id}) order by ordinal`;
      expect(rows.map((r) => r.id)).toEqual([b!.id, a!.id]);
      expect(errors(await auditCurriculum(db.sql, { snapshot: swapped }))).toEqual([]);
    } finally {
      await db.drop();
    }
  });

  it("retires leftovers of the same document that the snapshot no longer contains (a stale sub-topic)", async () => {
    const { db } = await freshlyLoaded();
    try {
      await db.sql`insert into public.subtopics (id, topic_id, ordinal, name, short_name, slug, strand_key, source_document_id, source_page, source_page_label, source_text)
                   values ('G3-NUM-STALE', 'G3-NUM', 99, 'Stale', 'Stale', 'STALE', 'stale', ${snapshot.document.id}, 17, '13', 'Stale')`;
      await loadSnapshot(db.sql, snapshot);
      const [stale] =
        await db.sql`select retired_at from public.subtopics where id = 'G3-NUM-STALE'`;
      expect(stale!.retired_at).not.toBeNull(); // kept as history, taken out of the active curriculum
      const [fine] =
        await db.sql`select count(*)::int as n from public.subtopics where retired_at is null`;
      expect(fine!.n).toBe(snapshot.subtopics.length);
    } finally {
      await db.drop();
    }
  });

  it("serialises concurrent loads (an advisory lock), leaving one consistent curriculum", async () => {
    const db = await createTestDatabase();
    try {
      const results = await Promise.allSettled([
        loadSnapshot(db.sql, snapshot),
        loadSnapshot(db.sql, snapshot),
        loadSnapshot(db.sql, snapshot),
      ]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
      expect(await count(db, "learning_objectives")).toBe(444);
      expect(errors(await auditCurriculum(db.sql, { snapshot }))).toEqual([]);
    } finally {
      await db.drop();
    }
  });
});

describe.skipIf(!TEST_DATABASE_URL)("the integrity audit detects damage to loaded data", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    ({ db } = await freshlyLoaded());
  });
  afterAll(async () => db?.drop());

  class Rollback extends Error {}

  /** Apply `damage`, audit, and ALWAYS roll back so each case starts from the clean load. */
  async function auditAfter(
    damage: (tx: TransactionSql) => Promise<void>,
    withSnapshot = false,
  ): Promise<AuditFinding[]> {
    let findings: AuditFinding[] = [];
    try {
      await db.sql.begin(async (tx) => {
        await damage(tx);
        findings = await auditCurriculum(tx, withSnapshot ? { snapshot } : {});
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    return findings;
  }
  const codes = (findings: AuditFinding[]) => errors(findings).map((f) => f.code);

  it("reports a clean database as clean (control)", async () => {
    expect(codes(await auditAfter(async () => {}))).toEqual([]);
  });

  it("detects a missing grade and the topics that went with it", async () => {
    const found = codes(
      await auditAfter(async (tx) => void (await tx`delete from public.grades where id = 'G6'`)),
    );
    expect(found).toContain("MISSING_GRADE");
  });

  it("detects a grade that lost one of the four topics", async () => {
    const found = await auditAfter(
      async (tx) => void (await tx`delete from public.topics where id = 'G5-MEA'`),
    );
    expect(codes(found)).toContain("MISSING_TOPIC");
    expect(errors(found).find((f) => f.code === "MISSING_TOPIC")!.examples).toEqual(["G5-MEA"]);
  });

  it("detects a sub-topic with no rows or objectives", async () => {
    const found = codes(
      await auditAfter(async (tx) => {
        await tx`insert into public.subtopics (id, topic_id, ordinal, name, short_name, slug, strand_key, source_document_id, source_page, source_text)
                 values ('G3-NUM-EMPTY', 'G3-NUM', 99, 'Empty', 'Empty', 'EMPTY', 'empty', 'mopse-junior-mathematics-2024-2030', 17, 'Empty')`;
      }),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        "SUBTOPIC_WITHOUT_ROWS",
        "SUBTOPIC_WITHOUT_OBJECTIVES",
        "ORDINAL_GAP",
      ]),
    );
  });

  it("detects a row that lost all its objectives", async () => {
    const found = codes(
      await auditAfter(async (tx) => {
        await tx`delete from public.learning_objectives where competency_row_id = 'G5-NUM-PROPER-FRACTIONS.R1'`;
      }),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        "ROW_WITHOUT_OBJECTIVES",
        "SUBTOPIC_WITHOUT_OBJECTIVES",
        "ORPHAN_CHUNK",
      ]),
    );
  });

  it("detects an objective whose id no longer matches its position, and gaps in ordering", async () => {
    const found = codes(
      await auditAfter(async (tx) => {
        await tx`update public.learning_objectives set ordinal_in_subtopic = 90 where id = 'G5-NUM-PROPER-FRACTIONS-002'`;
      }),
    );
    expect(found).toEqual(expect.arrayContaining(["INVALID_OBJECTIVE_ID", "ORDINAL_GAP"]));
  });

  it("detects reworded text that bypassed the loader: stale hash, stale chunk, and difference from the snapshot", async () => {
    // Wording edited in place: the stored hash no longer matches, and the chunk no longer quotes it.
    const stale = codes(
      await auditAfter(async (tx) => {
        await tx`update public.learning_objectives set text = 'something else entirely' where id = 'G5-NUM-PROPER-FRACTIONS-004'`;
      }, true),
    );
    expect(stale).toEqual(expect.arrayContaining(["TEXT_HASH_MISMATCH", "CHUNK_TEXT_STALE"]));
    // Wording AND hash edited consistently: only comparing against the snapshot reveals it.
    const consistent = codes(
      await auditAfter(async (tx) => {
        await tx`update public.learning_objectives
                 set text = 'something else entirely', text_hash = ${textHash("something else entirely")}
                 where id = 'G5-NUM-PROPER-FRACTIONS-004'`;
      }, true),
    );
    expect(consistent).toEqual(expect.arrayContaining(["SNAPSHOT_MISMATCH", "CHUNK_TEXT_STALE"]));
    expect(consistent).not.toContain("TEXT_HASH_MISMATCH");
  });

  it("detects a chunk whose content or metadata was altered", async () => {
    expect(
      codes(
        await auditAfter(
          async (tx) =>
            void (await tx`update public.curriculum_chunks set content = content || ' edited' where chunk_key = 'obj:G5-NUM-PROPER-FRACTIONS-004'`),
        ),
      ),
    ).toContain("CHUNK_HASH_MISMATCH");
    expect(
      codes(
        await auditAfter(
          async (tx) =>
            void (await tx`update public.curriculum_chunks set grade = 6 where chunk_key = 'obj:G5-NUM-PROPER-FRACTIONS-004'`),
        ),
      ),
    ).toContain("CHUNK_METADATA_MISMATCH");
  });

  it("detects an objective without a retrieval chunk", async () => {
    const found = await auditAfter(
      async (tx) =>
        void (await tx`delete from public.curriculum_chunks where chunk_key = 'obj:G5-NUM-PROPER-FRACTIONS-004'`),
    );
    expect(
      errors(found).find((f) => f.code === "OBJECTIVE_WITHOUT_CHUNK")!.examples.length,
    ).toBeGreaterThan(0);
  });

  it("detects a citation of a page outside the document or outside the objective's own topic", async () => {
    expect(
      codes(
        await auditAfter(
          async (tx) =>
            void (await tx`update public.learning_objectives set source_page = 500 where id = 'G3-NUM-WHOLE-NUMBERS-NUMERALS-001'`),
        ),
      ),
    ).toEqual(expect.arrayContaining(["MISSING_SOURCE_PAGE", "PAGE_OUTSIDE_TOPIC"]));
    expect(
      codes(
        await auditAfter(
          async (tx) =>
            void (await tx`update public.learning_objectives set source_page = 70 where id = 'G3-NUM-WHOLE-NUMBERS-NUMERALS-001'`),
        ),
      ),
    ).toContain("PAGE_OUTSIDE_TOPIC");
  });

  it("detects differences between the database and the snapshot it should equal", async () => {
    const found = await auditAfter(async (tx) => {
      await tx`delete from public.curriculum_content where id = (select id from public.curriculum_content order by id limit 1)`;
    }, true);
    expect(errors(found).filter((f) => f.code === "SNAPSHOT_MISMATCH")).toHaveLength(1);
  });

  it("detects chunks embedded by different models, and warns about chunks not yet embedded", async () => {
    const mixed = await auditAfter(async (tx) => {
      await tx`update public.curriculum_chunks set embedding = ${vector(1)}::extensions.vector, embedding_model = 'model-a' where chunk_key like 'obj:G3-%'`;
      await tx`update public.curriculum_chunks set embedding = ${vector(2)}::extensions.vector, embedding_model = 'model-b' where chunk_key like 'obj:G4-%'`;
    });
    expect(codes(mixed)).toContain("MIXED_EMBEDDING_MODELS");
    const none = await auditAfter(async () => {});
    expect(none.find((f) => f.code === "CHUNK_NOT_EMBEDDED")!.severity).toBe("warning");
  });

  it("detects an ACTIVE question whose objective has left the curriculum", async () => {
    const found = codes(
      await auditAfter(async (tx) => {
        await tx`insert into public.questions (learning_objective_id, grade, topic_code, subtopic_id, difficulty, question_type, stem, marking_method, source_type, generator, content_hash)
                 values ('G5-NUM-PROPER-FRACTIONS-004', 5, 'NUM', 'G5-NUM-PROPER-FRACTIONS', 1, 'NUMERIC', 'q', 'EXACT_NUMERIC', 'SUPPLEMENTAL', 'test', 'audit-q')`;
        await tx`update public.learning_objectives set retired_at = now() where id = 'G5-NUM-PROPER-FRACTIONS-004'`;
      }),
    );
    expect(found).toContain("ACTIVE_QUESTION_ON_RETIRED_OBJECTIVE");
  });

  it("CurriculumAuditError names the failures", async () => {
    const findings = await auditAfter(
      async (tx) => void (await tx`delete from public.topics where id = 'G5-MEA'`),
    );
    const error = new CurriculumAuditError(findings);
    expect(error.message).toContain("MISSING_TOPIC");
    expect(error.message).toContain("G5-MEA");
  });
});
