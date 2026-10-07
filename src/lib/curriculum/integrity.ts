import type { MatrixSubtopic, ObjectiveContext, TopicMatrix } from "./schemas";

/**
 * The application FAILS LOUDLY on invalid curriculum relationships (spec §21): before anything is
 * shown, the loaded hierarchy is re-checked against the rules the ingestion pipeline and the
 * database already enforce. If it ever fails, something upstream is corrupt and showing a plausible
 * but wrong curriculum would be worse than an error.
 */

export class CurriculumIntegrityError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `The curriculum data is inconsistent (${problems.length} problem(s)): ${problems.slice(0, 5).join("; ")}${
        problems.length > 5 ? "; …" : ""
      }`,
    );
    this.name = "CurriculumIntegrityError";
  }
}

const OBJECTIVE_ID = /^G\d{1,2}-(NUM|OPS|MEA|REL)-[A-Z0-9]+(-[A-Z0-9]+)*-\d{3}$/;

function contiguous(values: number[]): boolean {
  return [...values].sort((a, b) => a - b).every((v, i) => v === i + 1);
}

export function checkTopicMatrix(
  matrix: TopicMatrix,
  expected: { grade: number; code: string },
): string[] {
  const problems: string[] = [];
  const { topic, subtopics } = matrix;
  if (topic.grade !== expected.grade || topic.topic_code !== expected.code) {
    problems.push(
      `topic ${topic.topic_id} is for grade ${topic.grade} ${topic.topic_code}, not grade ${expected.grade} ${expected.code}`,
    );
  }
  if (topic.topic_id !== `${topic.grade_id}-${topic.topic_code}`) {
    problems.push(
      `topic id ${topic.topic_id} does not match its grade ${topic.grade_id} and code ${topic.topic_code}`,
    );
  }
  if (!contiguous(subtopics.map((s) => s.ordinal)))
    problems.push(`sub-topic positions of ${topic.topic_id} are not 1..n`);
  for (const subtopic of subtopics) problems.push(...checkSubtopic(subtopic, topic.topic_id));
  return problems;
}

function checkSubtopic(subtopic: MatrixSubtopic, topicId: string): string[] {
  const problems: string[] = [];
  if (!subtopic.id.startsWith(`${topicId}-`))
    problems.push(`sub-topic ${subtopic.id} does not belong to topic ${topicId}`);
  if (subtopic.competency_rows.length === 0)
    problems.push(`sub-topic ${subtopic.id} has no competency rows`);
  if (!contiguous(subtopic.competency_rows.map((r) => r.ordinal)))
    problems.push(`rows of ${subtopic.id} are not 1..n`);
  const all = subtopic.competency_rows.flatMap((r) => r.learning_objectives);
  if (!contiguous(all.map((o) => o.ordinal_in_subtopic)))
    problems.push(`objective positions of ${subtopic.id} are not 1..n`);
  for (const row of subtopic.competency_rows) {
    if (!row.id.startsWith(`${subtopic.id}.R`))
      problems.push(`row ${row.id} does not belong to sub-topic ${subtopic.id}`);
    if (row.learning_objectives.length === 0)
      problems.push(`row ${row.id} has no learning objectives`);
    if (!contiguous(row.learning_objectives.map((o) => o.ordinal_in_row)))
      problems.push(`objective positions in row ${row.id} are not 1..n`);
    for (const o of row.learning_objectives) {
      const expectedId = `${subtopic.id}-${String(o.ordinal_in_subtopic).padStart(3, "0")}`;
      if (o.id !== expectedId || !OBJECTIVE_ID.test(o.id))
        problems.push(
          `objective ${o.id} does not match its sub-topic ${subtopic.id} and position ${o.ordinal_in_subtopic}`,
        );
    }
  }
  return problems;
}

export function assertTopicMatrix(
  matrix: TopicMatrix,
  expected: { grade: number; code: string },
): TopicMatrix {
  const problems = checkTopicMatrix(matrix, expected);
  if (problems.length > 0) throw new CurriculumIntegrityError(problems);
  return matrix;
}

export function checkObjectiveContext(context: ObjectiveContext): string[] {
  const problems: string[] = [];
  const id = context.objective_id;
  if (!OBJECTIVE_ID.test(id)) problems.push(`objective id ${id} is not in the stable-id format`);
  if (!id.startsWith(`${context.subtopic_id}-`))
    problems.push(`objective ${id} is outside its sub-topic ${context.subtopic_id}`);
  if (!context.subtopic_id.startsWith(`${context.topic_id}-`))
    problems.push(`sub-topic ${context.subtopic_id} is outside its topic ${context.topic_id}`);
  if (context.topic_id !== `${context.grade_id}-${context.topic_code}`)
    problems.push(
      `topic ${context.topic_id} disagrees with grade ${context.grade_id} and code ${context.topic_code}`,
    );
  if (context.grade_id !== `G${context.grade}`)
    problems.push(`grade id ${context.grade_id} disagrees with grade number ${context.grade}`);
  if (!context.competency_row_id.startsWith(`${context.subtopic_id}.R`))
    problems.push(`row ${context.competency_row_id} is outside sub-topic ${context.subtopic_id}`);
  if (
    context.source_type !== "OFFICIAL_CURRICULUM" ||
    context.verification_status !== "VERIFIED_FROM_SOURCE"
  ) {
    problems.push(
      `objective ${id} is labelled ${context.source_type}/${context.verification_status}, not OFFICIAL_CURRICULUM/VERIFIED_FROM_SOURCE`,
    );
  }
  return problems;
}

export function assertObjectiveContext(context: ObjectiveContext): ObjectiveContext {
  const problems = checkObjectiveContext(context);
  if (problems.length > 0) throw new CurriculumIntegrityError(problems);
  return context;
}
