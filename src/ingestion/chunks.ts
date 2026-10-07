import { sha256 } from "./ids";
import {
  TOPIC_NAMES,
  type CurriculumSnapshot,
  type SnapshotRowItem,
  type TopicCode,
} from "./snapshot";

/**
 * Retrieval chunks (RAG) built from a validated snapshot.
 *
 * The syllabus is the highest-priority source, so every chunk is OFFICIAL_CURRICULUM text taken
 * from the snapshot (never paraphrased) and carries the metadata used to filter retrieval BEFORE any
 * similarity ranking: grade, subject, topic, sub-topic and — for competency chunks — the exact
 * learning objective. Page numbers are kept so an answer can always be traced to a printed page.
 *
 *   obj:<objective id>      one per learning objective: the objective plus the content, suggested
 *                           notes/activities and resources of the competency row it belongs to
 *   scope:<entry id>        one per grade × topic "Scope and Sequence" progression
 *   sec:<section id>[:n]    preamble and assessment prose (long sections are split on paragraphs)
 *
 * Keys are deterministic, so re-ingestion updates chunks in place instead of duplicating them.
 */

export type ChunkSectionType =
  "COMPETENCY_OBJECTIVE" | "SCOPE_AND_SEQUENCE" | "PREAMBLE" | "ASSESSMENT";

export interface ChunkRecord {
  chunk_key: string;
  section_type: ChunkSectionType;
  page: number;
  page_end: number | null;
  grade: number | null;
  subject: string | null;
  topic: string | null;
  topic_code: TopicCode | null;
  /** Short sub-topic name (without the "(0 – 1 000)" style qualifier) — the filterable name. */
  subtopic: string | null;
  subtopic_id: string | null;
  learning_objective_id: string | null;
  competency_row_id: string | null;
  content: string;
  content_hash: string;
}

/** Prose sections longer than this are split on paragraph boundaries. */
export const MAX_SECTION_CHUNK_CHARS = 1200;
/** Prose shorter than this (beyond its own heading) carries nothing worth retrieving. */
const MIN_SECTION_BODY_CHARS = 20;

function bullets(items: string[]): string {
  return items.map((text) => `- ${text}`).join("\n");
}

/** Split `text` into parts of at most `max` characters, preferring paragraph, then sentence boundaries. */
export function splitForChunks(text: string, max: number): string[] {
  const pieces: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (trimmed.length <= max) {
      pieces.push(trimmed);
      continue;
    }
    // An over-long paragraph: sentences first, then words.
    let current = "";
    for (const sentence of trimmed.split(/(?<=[.!?])\s+/)) {
      for (const word of sentence.length > max ? sentence.split(/\s+/) : [sentence]) {
        if (current !== "" && current.length + 1 + word.length > max) {
          pieces.push(current);
          current = word;
        } else {
          current = current === "" ? word : `${current} ${word}`;
        }
      }
    }
    if (current !== "") pieces.push(current);
  }
  const parts: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current !== "" && current.length + 1 + piece.length > max) {
      parts.push(current);
      current = piece;
    } else {
      current = current === "" ? piece : `${current}\n${piece}`;
    }
  }
  if (current !== "") parts.push(current);
  return parts;
}

function chunk(fields: Omit<ChunkRecord, "content_hash">): ChunkRecord {
  return { ...fields, content_hash: sha256(fields.content) };
}

export function buildChunks(snapshot: CurriculumSnapshot): ChunkRecord[] {
  const chunks: ChunkRecord[] = [];
  const subjectName = new Map(snapshot.subjects.map((s) => [s.id, s.name]));
  const gradeNumber = new Map(snapshot.grades.map((g) => [g.id, g.number]));
  const topicById = new Map(snapshot.topics.map((t) => [t.id, t]));
  const subtopicById = new Map(snapshot.subtopics.map((s) => [s.id, s]));
  const rowById = new Map(snapshot.competency_rows.map((r) => [r.id, r]));
  const byRow = (items: SnapshotRowItem[]) => {
    const map = new Map<string, SnapshotRowItem[]>();
    for (const item of items)
      map.set(item.competency_row_id, [...(map.get(item.competency_row_id) ?? []), item]);
    return map;
  };
  const contentByRow = byRow(snapshot.content);
  const activitiesByRow = byRow(snapshot.activities);
  const resourcesByRow = byRow(snapshot.resources);

  // ── one chunk per learning objective ───────────────────────────────────────────────────────
  for (const objective of snapshot.objectives) {
    const subtopic = subtopicById.get(objective.subtopic_id);
    const topic = subtopic && topicById.get(subtopic.topic_id);
    const row = rowById.get(objective.competency_row_id);
    if (!subtopic || !topic || !row) {
      throw new Error(
        `Cannot chunk objective ${objective.id}: its sub-topic, topic or row is missing from the snapshot`,
      );
    }
    const grade = gradeNumber.get(topic.grade_id);
    const subject = subjectName.get(topic.subject_id);
    if (grade === undefined || subject === undefined) {
      throw new Error(
        `Cannot chunk objective ${objective.id}: grade or subject of ${topic.id} is missing from the snapshot`,
      );
    }
    const lines = [
      `Grade ${grade} ${subject} — ${topic.name}${topic.scope_text ? ` (${topic.scope_text})` : ""}`,
      `Sub-topic: ${subtopic.group_name ? `${subtopic.group_name} › ` : ""}${subtopic.name}`,
      `Objective (pupils should be able to): ${objective.text}`,
    ];
    for (const [label, items] of [
      ["Content", contentByRow.get(row.id)],
      ["Suggested notes and activities", activitiesByRow.get(row.id)],
      ["Suggested resources", resourcesByRow.get(row.id)],
    ] as const) {
      if (items && items.length > 0) lines.push(`${label}:`, bullets(items.map((i) => i.text)));
    }
    chunks.push(
      chunk({
        chunk_key: `obj:${objective.id}`,
        section_type: "COMPETENCY_OBJECTIVE",
        page: objective.source.page,
        page_end: objective.source.page_end,
        grade,
        subject,
        topic: topic.name,
        topic_code: topic.code,
        subtopic: subtopic.short_name,
        subtopic_id: subtopic.id,
        learning_objective_id: objective.id,
        competency_row_id: row.id,
        content: lines.join("\n"),
      }),
    );
  }

  // ── scope and sequence ──────────────────────────────────────────────────────────────────
  const onlySubject = snapshot.subjects.length === 1 ? snapshot.subjects[0]!.name : null;
  for (const entry of snapshot.scope_sequence) {
    const topicName = TOPIC_NAMES[entry.topic_code];
    chunks.push(
      chunk({
        chunk_key: `scope:${entry.id}`,
        section_type: "SCOPE_AND_SEQUENCE",
        page: entry.source.page,
        page_end: entry.source.page_end,
        grade: entry.grade,
        subject: onlySubject,
        topic: topicName,
        topic_code: entry.topic_code,
        subtopic: null,
        subtopic_id: null,
        learning_objective_id: null,
        competency_row_id: null,
        content: [
          `Scope and sequence — Grade ${entry.grade} — ${topicName} (syllabus section ${entry.section_number})`,
          bullets(entry.items),
        ].join("\n"),
      }),
    );
  }

  // ── preamble and assessment prose ───────────────────────────────────────────────────────
  for (const section of snapshot.sections) {
    const body = section.text.startsWith(section.heading)
      ? section.text.slice(section.heading.length)
      : section.text;
    if (body.trim().length < MIN_SECTION_BODY_CHARS) continue; // a bare heading, or "…able to:" with nothing after it
    const parts = splitForChunks(section.text, MAX_SECTION_CHUNK_CHARS);
    parts.forEach((part, index) => {
      chunks.push(
        chunk({
          chunk_key: parts.length === 1 ? `sec:${section.id}` : `sec:${section.id}:${index + 1}`,
          section_type: section.kind,
          page: section.source.page,
          page_end: section.source.page_end,
          grade: null,
          subject: onlySubject,
          topic: null,
          topic_code: null,
          subtopic: null,
          subtopic_id: null,
          learning_objective_id: null,
          competency_row_id: null,
          // Later parts repeat the heading so each stands on its own when retrieved.
          content: index === 0 ? part : `${section.heading} (continued)\n${part}`,
        }),
      );
    });
  }

  const keys = new Set<string>();
  for (const c of chunks) {
    if (keys.has(c.chunk_key)) throw new Error(`Duplicate chunk key ${c.chunk_key}`);
    keys.add(c.chunk_key);
  }
  return chunks;
}
