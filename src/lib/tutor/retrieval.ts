import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { tokenize, toVectorLiteral, type EmbeddingProvider } from "../ai/embeddings";
import type { ObjectiveFacts } from "./moves";

/**
 * Grounding a child's own question in the syllabus (retrieval-augmented generation).
 *
 * What is retrieved is OFFICIAL syllabus text only, filtered by metadata BEFORE ranking — this grade,
 * this topic — so a Grade 5 child is never answered from Grade 7 material. Two searches are fused:
 *
 *   – a full-text search that runs inside our own database and may use the child's (already screened)
 *     words, because nobody else sees them;
 *   – a vector search whose query is built from the CURRICULUM CONTEXT (the goal, sub-topic and topic),
 *     never from what the child typed, so no child's text is sent to an embedding provider.
 *
 * The goal's own chunk is always in the running. What comes back is shown to the child apart from the
 * tutor's words, labelled as the syllabus's, with its page.
 */

export interface Passage {
  /** The chunk's key, e.g. "obj:G5-OPS-ADDITION-WHOLE-NUMBERS-001". */
  id: string;
  objectiveId: string | null;
  section: string;
  text: string;
  page: number | null;
  pageEnd: number | null;
}

export interface Retriever {
  passages(input: {
    message: string;
    objective: ObjectiveFacts;
    limit?: number;
  }): Promise<Passage[]>;
}

export interface SearchFilter {
  grade: number;
  topic: string;
}

/** The two searches and the goal's own chunk. Implemented over Supabase; faked in tests. */
export interface SearchPort {
  text(query: string, filter: SearchFilter, limit: number): Promise<Passage[]>;
  vector(embedding: number[], filter: SearchFilter, limit: number): Promise<Passage[]>;
  forObjective(objectiveId: string): Promise<Passage | null>;
}

// ── building the searches ───────────────────────────────────────────────────────────────────────

const STOP = new Set(
  (
    "a about after again all also am an and any are as at be because been before being but by can could did do does doing " +
    "done for from get got had has have he her here him his how i if in into is it its just like me more most my no not of " +
    "off on one only or other our out over please she so some than that the their them then there these they this those to " +
    "too up us very was we were what when where which who why will with would you your tell know mean means say why"
  ).split(" "),
);

/** The child's content words, for the full-text search (joined with "or" so one odd word does not empty the result). */
export function searchQuery(message: string): string {
  const words = message
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set(words)].slice(0, 8).join(" or ");
}

/** The phrase embedded for the vector search: curriculum context only. */
export function contextPhrase(objective: ObjectiveFacts): string {
  return `${objective.text}. ${objective.subtopicName}. ${objective.topicName}.`;
}

const RRF_K = 60;

/** Reciprocal-rank fusion of ranked lists; ties go to the first list that mentioned the passage. */
export function fuse(lists: ReadonlyArray<readonly Passage[]>, limit: number): Passage[] {
  const scores = new Map<string, { passage: Passage; score: number; first: number }>();
  lists.forEach((list, listIndex) => {
    list.forEach((passage, rank) => {
      const entry = scores.get(passage.id);
      const add = 1 / (RRF_K + rank + 1);
      if (entry) entry.score += add;
      else scores.set(passage.id, { passage, score: add, first: listIndex });
    });
  });
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.first - b.first)
    .slice(0, limit)
    .map((e) => e.passage);
}

const MAX_PASSAGE_CHARS = 700;

function trimmed(passage: Passage): Passage {
  if (passage.text.length <= MAX_PASSAGE_CHARS) return passage;
  const cut = passage.text.slice(0, MAX_PASSAGE_CHARS);
  const lastBreak = cut.lastIndexOf("\n");
  return { ...passage, text: (lastBreak > 200 ? cut.slice(0, lastBreak) : cut).trimEnd() };
}

export function createRetriever(port: SearchPort, embeddings: EmbeddingProvider | null): Retriever {
  return {
    async passages({ message, objective, limit = 3 }) {
      const filter: SearchFilter = { grade: objective.grade, topic: objective.topicName };
      const lists: Passage[][] = [];

      const own = await port.forObjective(objective.id);
      if (own) lists.push([own]);

      const query = searchQuery(message);
      if (query !== "") lists.push(await port.text(query, filter, 6));

      if (embeddings) {
        const [vector] = await embeddings.embed([contextPhrase(objective)]);
        if (vector) lists.push(await port.vector(vector, filter, 6));
      }
      return fuse(lists, limit).map(trimmed);
    },
  };
}

// ── choosing the line that answers ──────────────────────────────────────────────────────────────

const HEADER =
  /^(?:grade \d|sub-topic:|objective\b|content:|suggested (?:notes and activities|resources):)/i;

/**
 * The line of a passage that shares the most words with the child's message, or null when none does.
 * A line is the syllabus's own words, so it can be shown as a quotation.
 */
export function bestLine(passage: Passage, message: string): string | null {
  const wanted = new Set(tokenize(message));
  let best: { line: string; overlap: number } | null = null;
  for (const raw of passage.text.split("\n")) {
    const line = raw.replace(/^[-•\s]+/, "").trim();
    if (line === "" || HEADER.test(line)) continue;
    const overlap = new Set(tokenize(line).filter((t) => wanted.has(t))).size;
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { line, overlap };
  }
  return best ? best.line : null;
}

/** The best line across the passages, with the passage it came from. */
export function bestQuote(
  passages: readonly Passage[],
  message: string,
): { line: string; passage: Passage } | null {
  let best: { line: string; passage: Passage; overlap: number } | null = null;
  const wanted = new Set(tokenize(message));
  for (const passage of passages) {
    const line = bestLine(passage, message);
    if (!line) continue;
    const overlap = new Set(tokenize(line).filter((t) => wanted.has(t))).size;
    if (!best || overlap > best.overlap) best = { line, passage, overlap };
  }
  return best ? { line: best.line, passage: best.passage } : null;
}

// ── over Supabase ───────────────────────────────────────────────────────────────────────────────

const rowSchema = z.object({
  chunk_key: z.string(),
  section_type: z.string(),
  page: z.number().int().nullable(),
  page_end: z.number().int().nullable(),
  learning_objective_id: z.string().nullable(),
  content: z.string(),
});

const toPassage = (raw: unknown): Passage => {
  const row = rowSchema.parse(raw);
  return {
    id: row.chunk_key,
    objectiveId: row.learning_objective_id,
    section: row.section_type,
    text: row.content,
    page: row.page,
    pageEnd: row.page_end,
  };
};

/** Search over the `curriculum_chunks` table through its two retrieval functions (migration 0005). */
export class SupabaseSearchPort implements SearchPort {
  constructor(private readonly db: SupabaseClient) {}

  async text(query: string, filter: SearchFilter, limit: number): Promise<Passage[]> {
    const { data, error } = await this.db.rpc("search_curriculum_chunks_text", {
      query_text: query,
      match_count: limit,
      filter_grade: filter.grade,
      filter_subject: "mathematics",
      filter_topic: filter.topic,
    });
    if (error) throw new Error(`Syllabus search failed: ${error.message}`);
    return (data ?? []).map(toPassage);
  }

  async vector(embedding: number[], filter: SearchFilter, limit: number): Promise<Passage[]> {
    const { data, error } = await this.db.rpc("match_curriculum_chunks", {
      query_embedding: toVectorLiteral(embedding),
      match_count: limit,
      filter_grade: filter.grade,
      filter_subject: "mathematics",
      filter_topic: filter.topic,
    });
    if (error) throw new Error(`Syllabus similarity search failed: ${error.message}`);
    return (data ?? []).map(toPassage);
  }

  async forObjective(objectiveId: string): Promise<Passage | null> {
    const { data, error } = await this.db
      .from("curriculum_chunks")
      .select("chunk_key, section_type, page, page_end, learning_objective_id, content")
      .eq("learning_objective_id", objectiveId)
      .eq("section_type", "COMPETENCY_OBJECTIVE")
      .maybeSingle();
    if (error) throw new Error(`Could not read the goal's syllabus text: ${error.message}`);
    return data ? toPassage(data) : null;
  }
}
