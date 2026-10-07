import { describe, expect, it } from "vitest";
import { validateSnapshot } from "../../src/ingestion/validate";
import { cloneSnapshot, loadSnapshot } from "./snapshot-fixture";

const errorCodes = (s = cloneSnapshot()) =>
  validateSnapshot(s)
    .filter((i) => i.severity === "error")
    .map((i) => i.code);

describe("validateSnapshot on the real syllabus", () => {
  it("passes with no errors", () => {
    expect(validateSnapshot(loadSnapshot()).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("reports only the known, reviewed properties of the source as warnings", () => {
    const warnings = validateSnapshot(loadSnapshot()).filter((i) => i.severity === "warning");
    expect(warnings.map((w) => w.code).sort()).toEqual([
      "DUPLICATE_OBJECTIVE_TEXT",
      "LOWERCASE_NAME",
      "SOURCE_TYPO_SUSPECTED",
      "SOURCE_TYPO_SUSPECTED",
    ]);
  });
});

/**
 * "The application must fail loudly when ingestion produces invalid relationships."
 * Each test corrupts a good snapshot in one specific way and demands the matching error.
 */
describe("validateSnapshot detects every defect class from the spec", () => {
  it("missing grade", () => {
    const s = cloneSnapshot();
    s.grades = s.grades.filter((g) => g.number !== 5);
    expect(errorCodes(s)).toContain("MISSING_GRADE");
  });

  it("missing topic", () => {
    const s = cloneSnapshot();
    const gone = s.topics.find((t) => t.id === "G6-MEA")!;
    s.topics = s.topics.filter((t) => t !== gone);
    expect(errorCodes(s)).toContain("MISSING_TOPIC");
  });

  it("a topic with a wrong official name", () => {
    const s = cloneSnapshot();
    s.topics[0]!.name = "Numbers";
    expect(errorCodes(s)).toContain("INVALID_TOPIC_NAME");
  });

  it("a topic whose id disagrees with its grade", () => {
    const s = cloneSnapshot();
    s.topics[0]!.grade_id = "G4";
    expect(errorCodes(s)).toContain("INVALID_GRADE_TOPIC");
  });

  it("a topic that contradicts the grade printed in its own heading", () => {
    const s = cloneSnapshot();
    s.topics[0]!.heading_text = s.topics[0]!.heading_text.replace("GRADE 3", "GRADE 4");
    expect(errorCodes(s)).toContain("INVALID_GRADE_TOPIC");
  });

  it("missing sub-topics", () => {
    const s = cloneSnapshot();
    const topic = "G3-REL";
    const subs = new Set(s.subtopics.filter((x) => x.topic_id === topic).map((x) => x.id));
    s.subtopics = s.subtopics.filter((x) => !subs.has(x.id));
    s.competency_rows = s.competency_rows.filter((r) => !subs.has(r.subtopic_id));
    s.objectives = s.objectives.filter((o) => !subs.has(o.subtopic_id));
    expect(errorCodes(s)).toContain("MISSING_SUBTOPICS");
  });

  it("an objective without a parent sub-topic (orphan)", () => {
    const s = cloneSnapshot();
    s.objectives[0]!.subtopic_id = "G9-NUM-NOPE";
    expect(errorCodes(s)).toContain("ORPHAN_OBJECTIVE");
  });

  it("an objective without a parent row (orphan)", () => {
    const s = cloneSnapshot();
    s.objectives[0]!.competency_row_id = "G3-NUM-NOPE.R1";
    expect(errorCodes(s)).toContain("ORPHAN_OBJECTIVE");
  });

  it("an objective whose row belongs to a different sub-topic (invalid relationship)", () => {
    const s = cloneSnapshot();
    s.objectives[0]!.competency_row_id = s.competency_rows[s.competency_rows.length - 1]!.id;
    expect(errorCodes(s)).toContain("INVALID_GRADE_TOPIC");
  });

  it("duplicate objective ids", () => {
    const s = cloneSnapshot();
    s.objectives[1]!.id = s.objectives[0]!.id;
    expect(errorCodes(s)).toContain("DUPLICATE_ID");
  });

  it("duplicate sub-topic ids", () => {
    const s = cloneSnapshot();
    s.subtopics[1]!.id = s.subtopics[0]!.id;
    expect(errorCodes(s)).toContain("DUPLICATE_ID");
  });

  it("an orphaned content / activity / resource", () => {
    for (const kind of ["content", "activities", "resources"] as const) {
      const s = cloneSnapshot();
      s[kind][0]!.competency_row_id = "G3-NUM-NOPE.R9";
      expect(errorCodes(s), kind).toContain("ORPHAN_ITEM");
    }
  });

  it("an orphaned row", () => {
    const s = cloneSnapshot();
    s.competency_rows[0]!.subtopic_id = "G3-NUM-NOPE";
    expect(errorCodes(s)).toContain("ORPHAN_ROW");
  });

  it("a row with no objectives", () => {
    const s = cloneSnapshot();
    const row = s.competency_rows[0]!.id;
    s.objectives = s.objectives.filter((o) => o.competency_row_id !== row);
    expect(errorCodes(s)).toContain("ROW_WITHOUT_OBJECTIVES");
  });

  it("a sub-topic with no rows", () => {
    const s = cloneSnapshot();
    const sub = s.subtopics[0]!.id;
    s.competency_rows = s.competency_rows.filter((r) => r.subtopic_id !== sub);
    s.objectives = s.objectives.filter((o) => o.subtopic_id !== sub);
    expect(errorCodes(s)).toContain("SUBTOPIC_WITHOUT_ROWS");
  });

  it("missing source page, or a page beyond the document", () => {
    const s = cloneSnapshot();
    s.objectives[0]!.source.page = 0;
    expect(errorCodes(s)).toContain("MISSING_SOURCE_PAGE");
    const t = cloneSnapshot();
    t.objectives[0]!.source.page = 9999;
    expect(errorCodes(t)).toContain("MISSING_SOURCE_PAGE");
  });

  it("missing source text", () => {
    const s = cloneSnapshot();
    s.activities[0]!.source.source_text = "   ";
    expect(errorCodes(s)).toContain("MISSING_SOURCE_TEXT");
  });

  it("a record that cites a page belonging to a different topic (invalid grade/topic relationship)", () => {
    const s = cloneSnapshot();
    const g7 = s.objectives.find((o) => o.id.startsWith("G7-"))!;
    g7.source.page = 18; // a Grade 3 page
    expect(errorCodes(s)).toContain("PAGE_OUTSIDE_TOPIC");
  });

  it("a gap in the objective numbering", () => {
    const s = cloneSnapshot();
    const victim = s.objectives.find((o) => o.id === "G3-NUM-WORDS-001")!;
    s.objectives = s.objectives.filter((o) => o !== victim);
    expect(errorCodes(s)).toContain("ORDINAL_GAP");
  });

  it("an objective id that does not match its sub-topic and ordinal", () => {
    const s = cloneSnapshot();
    s.objectives[0]!.id = "G3-NUM-WRONG-001";
    expect(errorCodes(s)).toContain("INVALID_ID");
  });

  it("a stale text hash (wording changed under a stable id)", () => {
    const s = cloneSnapshot();
    s.objectives[0]!.text = "something else entirely";
    expect(errorCodes(s)).toContain("TEXT_HASH_MISMATCH");
  });

  it("unmapped superscript text nobody reviewed", () => {
    const s = cloneSnapshot();
    s.activities[0]!.normalizations = ["SUPERSCRIPT_UNMAPPED"];
    expect(errorCodes(s)).toContain("UNREVIEWED_TEXT");
  });

  it("assessment weightings that do not add up", () => {
    const s = cloneSnapshot();
    s.assessment.components[0]!.weighting_percent = 30;
    expect(errorCodes(s)).toContain("ASSESSMENT_WEIGHTS");
  });

  it("a specification grid that does not total 100%", () => {
    const s = cloneSnapshot();
    s.assessment.skill_bands[0]!.percent = 60;
    expect(errorCodes(s)).toContain("ASSESSMENT_SKILLS");
  });
});
