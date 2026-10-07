import { describe, expect, it } from "vitest";
import {
  assertObjectiveContext,
  assertTopicMatrix,
  checkObjectiveContext,
  checkTopicMatrix,
  CurriculumIntegrityError,
} from "../../src/lib/curriculum/integrity";
import type { ObjectiveContext, TopicMatrix } from "../../src/lib/curriculum/schemas";
import { loadSnapshot } from "../ingestion/snapshot-fixture";

const snapshot = loadSnapshot();

/** Builds the matrix the query layer returns, from the reviewed snapshot. */
function matrixFor(topicId: string): TopicMatrix {
  const topic = snapshot.topics.find((t) => t.id === topicId)!;
  const subtopics = snapshot.subtopics
    .filter((s) => s.topic_id === topicId)
    .map((s) => ({
      id: s.id,
      ordinal: s.ordinal,
      name: s.name,
      short_name: s.short_name,
      group_name: s.group_name,
      source_page: s.source.page,
      source_page_end: s.source.page_end,
      source_page_label: s.source.page_label,
      competency_rows: snapshot.competency_rows
        .filter((r) => r.subtopic_id === s.id)
        .map((r) => ({
          id: r.id,
          ordinal: r.ordinal,
          source_page: r.source.page,
          source_page_end: r.source.page_end,
          source_page_label: r.source.page_label,
          learning_objectives: snapshot.objectives
            .filter((o) => o.competency_row_id === r.id)
            .map((o) => ({
              id: o.id,
              ordinal_in_row: o.ordinal_in_row,
              ordinal_in_subtopic: o.ordinal_in_subtopic,
              text: o.text,
              retired_at: null,
              source_page: o.source.page,
              source_page_end: o.source.page_end,
              source_page_label: o.source.page_label,
            })),
          curriculum_content: [],
          curriculum_activities: [],
          curriculum_resources: [],
        })),
    }));
  return {
    topic: {
      topic_id: topic.id,
      grade_id: topic.grade_id,
      grade: Number(topic.grade_id.slice(1)),
      topic_code: topic.code,
      topic_name: topic.name,
      topic_ordinal: topic.ordinal,
      section_number: topic.section_number,
      heading_text: topic.heading_text,
      scope_text: topic.scope_text,
      source_page: topic.source.page,
      source_page_label: topic.source.page_label,
      subtopic_count: subtopics.length,
      objective_count: snapshot.objectives.filter((o) =>
        subtopics.some((s) => s.id === o.subtopic_id),
      ).length,
    },
    subtopics,
  };
}

describe("checkTopicMatrix", () => {
  it("accepts every topic of the real curriculum", () => {
    for (const topic of snapshot.topics) {
      const matrix = matrixFor(topic.id);
      expect(
        checkTopicMatrix(matrix, { grade: matrix.topic.grade, code: topic.code }),
        topic.id,
      ).toEqual([]);
    }
  });

  it("rejects a matrix served for the wrong grade or topic", () => {
    const matrix = matrixFor("G5-NUM");
    expect(checkTopicMatrix(matrix, { grade: 6, code: "NUM" })[0]).toMatch(/not grade 6 NUM/);
    expect(checkTopicMatrix(matrix, { grade: 5, code: "OPS" })[0]).toMatch(/not grade 5 OPS/);
  });

  it("rejects a sub-topic that belongs to a different topic", () => {
    const matrix = matrixFor("G5-NUM");
    matrix.subtopics[0]!.id = "G6-NUM-WHOLE-NUMBERS";
    expect(checkTopicMatrix(matrix, { grade: 5, code: "NUM" }).join("\n")).toMatch(
      /does not belong to topic G5-NUM/,
    );
  });

  it("rejects an objective placed under another sub-topic, or whose id disagrees with its position", () => {
    const matrix = matrixFor("G5-NUM");
    const objective = matrix.subtopics[0]!.competency_rows[0]!.learning_objectives[0]!;
    objective.id = "G5-NUM-SOMETHING-ELSE-001";
    expect(checkTopicMatrix(matrix, { grade: 5, code: "NUM" }).join("\n")).toMatch(
      /does not match its sub-topic/,
    );
  });

  it("rejects gaps in printed order and rows without objectives", () => {
    const matrix = matrixFor("G5-NUM");
    matrix.subtopics[1]!.ordinal = 7;
    matrix.subtopics[0]!.competency_rows[0]!.learning_objectives = [];
    const problems = checkTopicMatrix(matrix, { grade: 5, code: "NUM" }).join("\n");
    expect(problems).toMatch(/sub-topic positions .* are not 1\.\.n/);
    expect(problems).toMatch(/has no learning objectives/);
  });

  it("throws a CurriculumIntegrityError naming the problems", () => {
    const matrix = matrixFor("G5-NUM");
    matrix.subtopics[0]!.competency_rows = [];
    expect(() => assertTopicMatrix(matrix, { grade: 5, code: "NUM" })).toThrow(
      CurriculumIntegrityError,
    );
    expect(() => assertTopicMatrix(matrix, { grade: 5, code: "NUM" })).toThrow(
      /has no competency rows/,
    );
  });
});

function contextFor(objectiveId: string): ObjectiveContext {
  const o = snapshot.objectives.find((x) => x.id === objectiveId)!;
  const s = snapshot.subtopics.find((x) => x.id === o.subtopic_id)!;
  const t = snapshot.topics.find((x) => x.id === s.topic_id)!;
  return {
    objective_id: o.id,
    objective_text: o.text,
    ordinal_in_subtopic: o.ordinal_in_subtopic,
    ordinal_in_row: o.ordinal_in_row,
    retired_at: null,
    competency_row_id: o.competency_row_id,
    subtopic_id: s.id,
    subtopic_name: s.name,
    subtopic_short_name: s.short_name,
    subtopic_group_name: s.group_name,
    strand_key: s.strand_key,
    topic_id: t.id,
    topic_code: t.code,
    topic_name: t.name,
    topic_scope_text: t.scope_text,
    grade_id: t.grade_id,
    grade: Number(t.grade_id.slice(1)),
    subject_id: "MATH",
    subject_name: "Mathematics",
    source_document_id: snapshot.document.id,
    source_title: snapshot.document.title,
    organisation: snapshot.document.organisation,
    curriculum_year: snapshot.document.curriculum_year,
    source_page: o.source.page,
    source_page_end: o.source.page_end,
    source_page_label: o.source.page_label,
    source_text: o.source.source_text,
    source_type: "OFFICIAL_CURRICULUM",
    verification_status: "VERIFIED_FROM_SOURCE",
  };
}

describe("checkObjectiveContext", () => {
  it("accepts every objective of the real curriculum", () => {
    for (const o of snapshot.objectives)
      expect(checkObjectiveContext(contextFor(o.id)), o.id).toEqual([]);
  });

  it("rejects a grade/topic/sub-topic chain that disagrees with itself", () => {
    const context = { ...contextFor("G5-NUM-PROPER-FRACTIONS-004"), grade: 6, grade_id: "G6" };
    expect(checkObjectiveContext(context).join("\n")).toMatch(/disagrees with grade/);
  });

  it("rejects an objective that is not labelled official and verified from the source", () => {
    const context = { ...contextFor("G5-NUM-PROPER-FRACTIONS-004"), source_type: "AI_GENERATED" };
    expect(checkObjectiveContext(context).join("\n")).toMatch(
      /not OFFICIAL_CURRICULUM\/VERIFIED_FROM_SOURCE/,
    );
    expect(() => assertObjectiveContext(context)).toThrow(CurriculumIntegrityError);
  });

  it("rejects an objective outside its sub-topic", () => {
    const context = {
      ...contextFor("G5-NUM-PROPER-FRACTIONS-004"),
      subtopic_id: "G5-NUM-DECIMALS",
    };
    expect(checkObjectiveContext(context).join("\n")).toMatch(/outside its sub-topic/);
  });
});
