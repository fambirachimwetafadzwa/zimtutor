import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildChunks, MAX_SECTION_CHUNK_CHARS, splitForChunks } from "../../src/ingestion/chunks";
import { loadSnapshot } from "./snapshot-fixture";

const snapshot = loadSnapshot();
const chunks = buildChunks(snapshot);
const byKey = new Map(chunks.map((c) => [c.chunk_key, c]));

describe("splitForChunks", () => {
  it("keeps short text in one part", () => {
    expect(splitForChunks("One line.\nTwo lines.", 100)).toEqual(["One line.\nTwo lines."]);
  });

  it("splits on paragraph boundaries without cutting a paragraph", () => {
    const parts = splitForChunks(["a".repeat(60), "b".repeat(60), "c".repeat(60)].join("\n"), 130);
    expect(parts).toEqual([`${"a".repeat(60)}\n${"b".repeat(60)}`, "c".repeat(60)]);
  });

  it("splits an over-long paragraph at sentence boundaries", () => {
    const sentence = "This is a sentence of moderate length.";
    const parts = splitForChunks(Array.from({ length: 10 }, () => sentence).join(" "), 100);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(100);
      expect(part.endsWith(".")).toBe(true);
    }
  });

  it("never loses a word, whatever the limit", () => {
    const text =
      "Learners shall do one school-based project per grade.\nEach will contribute ten percent of the final mark.";
    for (const max of [20, 40, 80, 500]) {
      const words = splitForChunks(text, max).join(" ").split(/\s+/);
      expect(words).toEqual(text.split(/\s+/));
    }
  });

  it("ignores blank lines and returns nothing for empty text", () => {
    expect(splitForChunks("\n  \n", 50)).toEqual([]);
  });
});

describe("curriculum chunks", () => {
  it("builds exactly one competency chunk per learning objective", () => {
    const competency = chunks.filter((c) => c.section_type === "COMPETENCY_OBJECTIVE");
    expect(competency).toHaveLength(snapshot.objectives.length);
    expect(new Set(competency.map((c) => c.learning_objective_id)).size).toBe(
      snapshot.objectives.length,
    );
    for (const objective of snapshot.objectives)
      expect(byKey.has(`obj:${objective.id}`)).toBe(true);
  });

  it("has unique keys and non-empty, hash-consistent content on valid pages", () => {
    expect(new Set(chunks.map((c) => c.chunk_key)).size).toBe(chunks.length);
    for (const c of chunks) {
      expect(c.content.trim()).not.toBe("");
      expect(c.content_hash).toBe(createHash("sha256").update(c.content, "utf8").digest("hex"));
      expect(c.page).toBeGreaterThanOrEqual(1);
      expect(c.page).toBeLessThanOrEqual(snapshot.document.page_count);
    }
  });

  it("carries the metadata used to filter retrieval (grade, subject, topic, sub-topic, objective)", () => {
    const chunk = byKey.get("obj:G5-NUM-PROPER-FRACTIONS-004")!;
    expect(chunk).toMatchObject({
      section_type: "COMPETENCY_OBJECTIVE",
      grade: 5,
      subject: "Mathematics",
      topic: "Number",
      topic_code: "NUM",
      subtopic: "Proper Fractions",
      subtopic_id: "G5-NUM-PROPER-FRACTIONS",
      learning_objective_id: "G5-NUM-PROPER-FRACTIONS-004",
    });
    expect(chunk.competency_row_id).toMatch(/^G5-NUM-PROPER-FRACTIONS\.R\d+$/);
  });

  it("states the official objective, the printed sub-topic scope and the row's content, activities and resources", () => {
    const chunk = byKey.get("obj:G5-NUM-PROPER-FRACTIONS-004")!;
    expect(chunk.content).toContain("Grade 5 Mathematics — Number");
    // The qualifier in the printed sub-topic name is the scope boundary the tutor must respect.
    expect(chunk.content).toContain("Proper Fractions (denominators 2 to 10 and 20)");
    expect(chunk.content).toContain("Objective (pupils should be able to): compare fractions");
    expect(chunk.content).toMatch(/Content:\n- /);
    expect(chunk.content).toMatch(/Suggested notes and activities:\n- /);
    expect(chunk.content).toMatch(/Suggested resources:\n- /);
  });

  it("includes the exact official wording of every objective, and shares row content between its objectives", () => {
    for (const objective of snapshot.objectives) {
      expect(byKey.get(`obj:${objective.id}`)!.content).toContain(objective.text);
    }
    const row = snapshot.competency_rows.find(
      (r) => snapshot.objectives.filter((o) => o.competency_row_id === r.id).length >= 2,
    )!;
    const siblings = snapshot.objectives.filter((o) => o.competency_row_id === row.id);
    const firstContent = snapshot.content.find((c) => c.competency_row_id === row.id)?.text;
    if (firstContent) {
      for (const objective of siblings)
        expect(byKey.get(`obj:${objective.id}`)!.content).toContain(firstContent);
    }
  });

  it("does not leak another row's content into a chunk", () => {
    // Any sub-topic printed over several rows: each row's objectives see only that row's bullets.
    const rowsOf = (subtopicId: string) =>
      snapshot.competency_rows.filter((r) => r.subtopic_id === subtopicId);
    const subtopic = snapshot.subtopics.find((s) => rowsOf(s.id).length >= 2)!;
    const [firstRow, secondRow] = rowsOf(subtopic.id);
    const textsOf = (rowId: string) =>
      snapshot.content.filter((c) => c.competency_row_id === rowId).map((c) => c.text);
    const own = new Set(textsOf(firstRow!.id));
    const foreign = textsOf(secondRow!.id).filter((t) => !own.has(t));
    expect(foreign.length).toBeGreaterThan(0);
    const objective = snapshot.objectives.find((o) => o.competency_row_id === firstRow!.id)!;
    for (const text of foreign)
      expect(byKey.get(`obj:${objective.id}`)!.content).not.toContain(`- ${text}\n`);
  });

  it("keeps the syllabus's teaching constraints (NB notes) inside the chunk of the row they qualify", () => {
    const withNote = chunks.filter((c) =>
      c.content.includes("NB: teachers should not teach the term commutative law"),
    );
    expect(withNote.length).toBeGreaterThan(0);
    expect(withNote.every((c) => c.section_type === "COMPETENCY_OBJECTIVE")).toBe(true);
  });

  it("builds one scope-and-sequence chunk per grade and topic", () => {
    const scope = chunks.filter((c) => c.section_type === "SCOPE_AND_SEQUENCE");
    expect(scope).toHaveLength(20);
    const g5 = byKey.get("scope:SS-G5-NUM")!;
    expect(g5).toMatchObject({
      grade: 5,
      topic: "Number",
      topic_code: "NUM",
      learning_objective_id: null,
    });
    expect(g5.content).toContain("Numerals (0 to 100 000)");
  });

  it("chunks the preamble and assessment prose, skipping bare headings, and keeps parts self-describing", () => {
    expect(byKey.has("sec:SEC-PREAMBLE-1")).toBe(false); // "1 PREAMBLE" alone
    expect(byKey.has("sec:SEC-PREAMBLE-2")).toBe(true);
    const assessment = chunks.filter((c) => c.section_type === "ASSESSMENT");
    expect(assessment.length).toBeGreaterThan(0);
    const scheme = chunks.filter((c) => c.chunk_key.startsWith("sec:SEC-ASSESSMENT-17"));
    expect(scheme.length).toBeGreaterThan(1); // 9.3 is long, so it is split
    for (const part of scheme)
      expect(part.content.length).toBeLessThanOrEqual(MAX_SECTION_CHUNK_CHARS + 60);
    expect(
      scheme.slice(1).every((p) => p.content.startsWith("9.3 Scheme of Assessment (continued)")),
    ).toBe(true);
    // The 20/80 weighting is retrievable from prose.
    expect(
      assessment.some((c) => c.content.includes("School Based Continuous Assessment | 20%")),
    ).toBe(true);
  });

  it("is deterministic", () => {
    expect(buildChunks(snapshot)).toEqual(chunks);
  });

  it("refuses to chunk a snapshot with a dangling relationship", () => {
    const broken = structuredClone(snapshot);
    broken.objectives[0]!.competency_row_id = "G9-NUM-NOPE.R1";
    expect(() => buildChunks(broken)).toThrow(/missing from the snapshot/);
  });
});
