import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { extractSnapshot, type ExtractionResult } from "../../src/ingestion/extract";
import { serializeSnapshot } from "../../src/ingestion/serialize";
import { loadSnapshot, SNAPSHOT_PATH } from "./snapshot-fixture";

/**
 * Integration tests over the REAL syllabus PDF.
 *
 * Counts below were verified two ways before being pinned: objectives per grade/topic were compared
 * with an independent implementation (different PDF library and code path) and matched exactly
 * (444/444), and the characters on the matrix pages were compared with poppler's `pdftotext` and
 * matched exactly in both directions. Content/activity/resource counts depend on bullet-merging
 * rules and are regression guards.
 */

const root = path.resolve("curriculum");
const options = {
  pdfPath: path.join(root, "source", "mopse-junior-mathematics-2024-2030.pdf"),
  manifestPath: path.join(root, "source", "manifest.json"),
  overridesPath: path.join(root, "overrides", "mopse-junior-mathematics-2024-2030.json"),
};

// subtopics, rows, objectives, content, activities, resources
const GOLDEN: Record<string, [number, number, number, number, number, number]> = {
  "G3-NUM": [10, 10, 20, 11, 22, 29],
  "G3-OPS": [7, 7, 13, 8, 21, 28],
  "G3-MEA": [11, 14, 27, 20, 41, 48],
  "G3-REL": [1, 3, 4, 4, 8, 4],
  "G4-NUM": [6, 7, 31, 17, 33, 23],
  "G4-OPS": [10, 10, 14, 12, 29, 47],
  "G4-MEA": [10, 10, 34, 25, 46, 43],
  "G4-REL": [1, 4, 8, 6, 11, 17],
  "G5-NUM": [5, 7, 40, 22, 38, 27],
  "G5-OPS": [12, 12, 23, 15, 29, 34],
  "G5-MEA": [10, 10, 29, 25, 53, 54],
  "G5-REL": [1, 1, 2, 6, 5, 6],
  "G6-NUM": [5, 7, 36, 23, 37, 27],
  "G6-OPS": [13, 13, 21, 14, 30, 37],
  "G6-MEA": [10, 10, 34, 23, 53, 65],
  "G6-REL": [1, 1, 3, 6, 7, 9],
  "G7-NUM": [5, 7, 41, 25, 41, 30],
  "G7-OPS": [13, 13, 23, 19, 32, 38],
  "G7-MEA": [10, 11, 38, 19, 46, 67],
  "G7-REL": [1, 1, 3, 6, 7, 9],
};

describe("extraction of the official syllabus", () => {
  let result: ExtractionResult;
  beforeAll(async () => {
    result = await extractSnapshot(options);
  }, 120_000);

  it("finds nothing wrong: every equation reviewed, no stale corrections, all text accounted for", () => {
    expect(result.issues).toEqual([]);
  });

  it("is repeatable: the output is byte-for-byte the committed snapshot", () => {
    expect(serializeSnapshot(result.snapshot)).toBe(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
  });

  it("is repeatable across runs in the same process", async () => {
    const again = await extractSnapshot(options);
    expect(serializeSnapshot(again.snapshot)).toBe(serializeSnapshot(result.snapshot));
  }, 120_000);

  it("covers Grades 3–7 and all four official topics, named exactly as the syllabus names them", () => {
    const s = result.snapshot;
    expect(s.grades.map((g) => g.number)).toEqual([3, 4, 5, 6, 7]);
    for (const grade of s.grades) {
      const topics = s.topics.filter((t) => t.grade_id === grade.id).map((t) => t.name);
      expect(topics, grade.id).toEqual(["Number", "Operations", "Measures", "Relationships"]);
    }
  });

  it("matches the verified per-topic counts", () => {
    const s = result.snapshot;
    const actual: typeof GOLDEN = {};
    for (const t of s.topics) {
      const subs = s.subtopics.filter((x) => x.topic_id === t.id);
      const rowIds = new Set(
        s.competency_rows.filter((r) => subs.some((x) => x.id === r.subtopic_id)).map((r) => r.id),
      );
      const inRows = (xs: Array<{ competency_row_id: string }>) =>
        xs.filter((x) => rowIds.has(x.competency_row_id)).length;
      actual[t.id] = [
        subs.length,
        rowIds.size,
        s.objectives.filter((o) => subs.some((x) => x.id === o.subtopic_id)).length,
        inRows(s.content),
        inRows(s.activities),
        inRows(s.resources),
      ];
    }
    expect(actual).toEqual(GOLDEN);
    expect(s.objectives).toHaveLength(444);
  });

  it("retains the source page, printed page label and verbatim text for every record", () => {
    const s = result.snapshot;
    const records = [
      ...s.topics,
      ...s.subtopics,
      ...s.competency_rows,
      ...s.objectives,
      ...s.content,
      ...s.activities,
      ...s.resources,
    ];
    for (const r of records) {
      expect(r.source.page).toBeGreaterThanOrEqual(1);
      expect(r.source.page).toBeLessThanOrEqual(s.document.page_count);
      expect(r.source.source_text.trim().length).toBeGreaterThan(0);
      expect(r.source.page_label).toBe(String(r.source.page - 4)); // printed numbering starts at PDF page 5
    }
  });

  it("marks everything as verified official curriculum from the right document", () => {
    const d = result.snapshot.document;
    expect(d).toMatchObject({
      title: "Revised Junior Mathematics Syllabus MoPSE 2024 - 2030",
      curriculum_year: "2024-2030",
      source_type: "OFFICIAL_CURRICULUM",
      verification_status: "VERIFIED_FROM_SOURCE",
      sha256: "1c17924eaa9addf88de225d289daff779e518357658cc4ea1cc17e53df75d239",
      objective_stem: "Pupils should be able to:",
    });
  });

  it("generates the documented stable ids and no id is duplicated", () => {
    const s = result.snapshot;
    for (const id of s.objectives.map((o) => o.id))
      expect(id).toMatch(/^G[3-7]-(NUM|OPS|MEA|REL)-[A-Z0-9]+(-[A-Z0-9]+)*-\d{3}$/);
    expect(new Set(s.objectives.map((o) => o.id)).size).toBe(s.objectives.length);
    expect(s.subtopics.map((x) => x.id)).toEqual(
      expect.arrayContaining([
        "G3-NUM-WHOLE-NUMBERS-NUMERALS",
        "G7-MEA-RATE",
        "G7-REL-DATA-HANDLING",
        "G5-MEA-AREA",
      ]),
    );
  });

  it("preserves the objectives the product spec uses as its examples, as independent objectives", () => {
    const byId = new Map(result.snapshot.objectives.map((o) => [o.id, o]));
    expect(byId.get("G3-NUM-WHOLE-NUMBERS-NUMERALS-001")!.text).toBe(
      "read/sign number in numerals",
    );
    expect(byId.get("G3-NUM-WHOLE-NUMBERS-NUMERALS-002")!.text).toBe("write number in numerals");
    // Grade 5 Proper Fractions: "compare fractions" and "reduce fractions to lowest terms" can be mastered independently.
    expect(byId.get("G5-NUM-PROPER-FRACTIONS-004")!.text).toBe("compare fractions");
    expect(byId.get("G5-NUM-PROPER-FRACTIONS-006")!.text).toBe(
      "reduce fractions to their lowest terms",
    );
    // Grade 7 Money -> "calculate profit or loss"
    expect(
      [...byId.values()].find(
        (o) => o.id.startsWith("G7-MEA-MONEY") && o.text === "calculate profit or loss",
      ),
    ).toBeDefined();
  });

  it("keeps the bold group heading only where the syllabus prints it", () => {
    const groups = result.snapshot.subtopics.filter((x) => x.group_name !== null);
    expect(groups.map((g) => [g.id, g.group_name])).toEqual([
      ["G3-NUM-WHOLE-NUMBERS-NUMERALS", "Whole numbers"],
    ]);
  });

  it("links objectives to the row whose content, activities and resources they share", () => {
    const s = result.snapshot;
    const objective = s.objectives.find((o) => o.id === "G3-NUM-PLACE-VALUE-DIGITS-002")!;
    const row = s.competency_rows.find((r) => r.id === objective.competency_row_id)!;
    expect(row.subtopic_id).toBe(objective.subtopic_id);
    expect(s.content.filter((c) => c.competency_row_id === row.id).map((c) => c.text)).toEqual([
      "Place value",
    ]);
    expect(s.resources.filter((c) => c.competency_row_id === row.id).map((c) => c.text)).toEqual([
      "Charts",
      "Abacus",
      "Counters for place value",
      "Strips with numbers",
    ]);
  });

  it("repairs a row the producer split across a page break", () => {
    const s = result.snapshot;
    const row = s.competency_rows.find((r) => r.id === "G3-OPS-SUBTRACTION-WHOLE-NUMBERS.R1")!;
    expect(row.assembly).toEqual(["head:p20", "tail:p21"]);
    expect(row.source.page_end).toBe(21);
  });

  it("represents a sub-topic that spans several printed rows as ONE sub-topic with several rows", () => {
    const s = result.snapshot;
    const time = s.competency_rows.filter((r) => r.subtopic_id === "G3-MEA-TIME");
    expect(time).toHaveLength(4);
    expect(s.objectives.filter((o) => o.subtopic_id === "G3-MEA-TIME")).toHaveLength(8);
  });

  it("converts superscripts but never alters the verbatim source text", () => {
    const s = result.snapshot;
    const note = s.activities.find((a) =>
      a.text.startsWith("NB: Volume is measured in cubic units"),
    )!;
    expect(note.text).toBe("NB: Volume is measured in cubic units (cm³/ m³)");
    expect(note.source.source_text).toBe("NB: Volume is measured in cubic units (cm3/ m3)");
    expect(note.normalizations).toContain("SUPERSCRIPT");
  });

  it("corrects flattened equations through reviewed overrides only (365¼ is not 36541)", () => {
    const s = result.snapshot;
    const year = s.activities.find((a) => a.id === "G5-MEA-TIME.R1:ACT10")!;
    expect(year.text).toBe("1 ordinary year = 365 1/4 days");
    expect(year.source.source_text).toContain("36541");
    expect(year.normalizations).toContain("REVIEWED_OVERRIDE");
  });

  it("keeps curriculum notes (NB:) as separate items, including the Grade 3 'do not teach' boundary", () => {
    const notes = result.snapshot.activities.filter((a) => /^NB\b/.test(a.text));
    expect(notes).toHaveLength(10);
    expect(notes.map((n) => n.text)).toContain(
      "NB: teachers should not teach the term commutative law",
    );
  });

  it("flags suspected typos in the official text rather than silently fixing them", () => {
    const typos = result.snapshot.warnings.filter((w) => w.code === "SOURCE_TYPO_SUSPECTED");
    expect(typos).toHaveLength(2);
    const degrees = result.snapshot.objectives.find((o) => o.text.endsWith("degrees0"));
    expect(degrees).toBeDefined(); // the official wording is preserved verbatim
  });

  it("extracts the assessment model from the document (20% SBCA / 80% summative)", () => {
    const a = result.snapshot.assessment;
    expect(a.components.map((c) => [c.id, c.weighting_percent])).toEqual([
      ["SBCA", 20],
      ["SA", 80],
    ]);
    expect(a.components[0]!.details).toMatchObject({
      grade_with_two_projects: 7,
      projects_at_that_grade: 2,
      weight_percent_each_of_two: 10,
    });
    const [p1, p2] = a.papers;
    expect(p1).toMatchObject({
      id: "ZIMSEC-G7-P1",
      marks: 40,
      duration_minutes: 120,
      paper_weighting_percent: 50,
      summative_weighting_percent: 80,
    });
    expect(p1!.structure).toMatchObject({ question_type: "MULTIPLE_CHOICE", question_count: 40 });
    expect(p2).toMatchObject({
      id: "ZIMSEC-G7-P2",
      marks: 40,
      duration_minutes: 120,
      paper_weighting_percent: 30,
    });
    expect(p2!.structure).toMatchObject({
      sections: [
        { id: "A", total_marks: 25 },
        { id: "B", questions: 6, marks_each: 5, choose: 3, total_marks: 15 },
      ],
    });
  });

  it("extracts the specification grid with THREE official skill bands", () => {
    const grid = result.snapshot.assessment.skill_bands
      .filter((b) => b.paper_number === 1)
      .map((b) => [b.skill_band_code, b.percent]);
    expect(grid).toEqual([
      ["KNOWLEDGE_COMPREHENSION", 50],
      ["APPLICATION_ANALYSIS", 40],
      ["PROBLEM_SOLVING", 10],
    ]);
  });

  it("extracts the 11 assessment objectives and the 6-stage, 50-mark project scheme", () => {
    const a = result.snapshot.assessment;
    expect(a.objectives.map((o) => o.code)).toEqual(
      Array.from({ length: 11 }, (_, i) => `9.1.${i + 1}`),
    );
    expect(a.project_stages.map((p) => p.marks)).toEqual([5, 10, 10, 10, 10, 5]);
  });

  it("captures the scope-and-sequence progression for every grade and topic", () => {
    expect(result.snapshot.scope_sequence).toHaveLength(20);
    const g5num = result.snapshot.scope_sequence.find((x) => x.id === "SS-G5-NUM")!;
    expect(g5num.items.join(" | ")).toContain("Numerals (0 to 100 000)");
  });

  it("preserves every page (page-preserved text for audit and RAG)", () => {
    const pages = result.snapshot.pages;
    expect(pages).toHaveLength(83);
    expect(pages.map((p) => p.page)).toEqual(Array.from({ length: 83 }, (_, i) => i + 1));
    // The cover is a graphic with no body text; every other page carries text.
    expect(pages.filter((p) => p.text.trim() === "").map((p) => p.page)).toEqual([1]);
    // Printed labels: roman numerals for the front matter, then arabic starting at the preamble.
    expect(pages.slice(0, 4).map((p) => p.page_label)).toEqual(["i", "ii", "iii", "iv"]);
    expect(pages[4]!.page_label).toBe("1");
    expect(pages[4]!.text).toContain("PREAMBLE");
    expect(pages[82]!.page_label).toBe("79");
  });

  it("the committed snapshot validates against the schema", () => {
    expect(loadSnapshot().objectives).toHaveLength(444);
  });
});

describe("safeguards in the pipeline", () => {
  it("refuses a PDF that does not match the manifest checksum (it could be a different document)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zt-manifest-"));
    const manifest = JSON.parse(fs.readFileSync(options.manifestPath, "utf8")) as Record<
      string,
      unknown
    >;
    manifest.sha256 = "0".repeat(64);
    const tampered = path.join(dir, "manifest.json");
    fs.writeFileSync(tampered, JSON.stringify(manifest));
    await expect(extractSnapshot({ ...options, manifestPath: tampered })).rejects.toThrow(
      /does not match the manifest/,
    );
  }, 120_000);

  it("refuses to ship an unreviewed Word equation: without overrides, every flagged item is reported", async () => {
    const { issues } = await extractSnapshot({ ...options, overridesPath: "/nonexistent.json" });
    const unreviewed = issues.filter((i) => i.code === "UNREVIEWED_MATH_NOTATION");
    expect(unreviewed.map((i) => i.page)).toEqual([23, 40, 41, 42, 44, 45, 47, 51, 59, 61, 61]);
  }, 120_000);

  it("refuses stale corrections that no longer match the document", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zt-overrides-"));
    const real = JSON.parse(fs.readFileSync(options.overridesPath, "utf8")) as {
      text_fixes: Array<Record<string, unknown>>;
    };
    real.text_fixes.push({
      page: 30,
      match: "this text does not exist on page 30",
      text: "irrelevant",
      reason: "a stale correction used by a test",
      verified: "a test fixture, not a real review",
    });
    const file = path.join(dir, "o.json");
    fs.writeFileSync(file, JSON.stringify(real));
    const { issues } = await extractSnapshot({ ...options, overridesPath: file });
    expect(issues.map((i) => i.code)).toEqual(["STALE_OVERRIDE"]);
  }, 120_000);
});
