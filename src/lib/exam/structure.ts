import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CurriculumSnapshot } from "../../ingestion/snapshot";

/**
 * The OFFICIAL shape of the Grade 7 examination, as the syllabus states it (section 9): the two
 * papers, how long and how many marks they have, how Paper 2 is divided, and the specification grid
 * that says what share of each paper tests which skill. These facts come from the database (loaded
 * from the syllabus with the page they were read on), never from numbers typed into the code, so
 * ZimTutor's practice papers follow the document and say where they got their shape.
 */

export const BANDS = [
  "KNOWLEDGE_COMPREHENSION",
  "APPLICATION_ANALYSIS",
  "PROBLEM_SOLVING",
] as const;
export type SkillBand = (typeof BANDS)[number];
export type Proportions = Record<SkillBand, number>;

export const BAND_LABELS: Record<SkillBand, string> = {
  KNOWLEDGE_COMPREHENSION: "Knowledge and comprehension",
  APPLICATION_ANALYSIS: "Application and analysis",
  PROBLEM_SOLVING: "Problem solving",
};

export interface Citation {
  page: number;
  label: string | null;
}

export type PaperStructure =
  | { kind: "CHOICE"; questions: number; marksEach: number }
  | {
      kind: "STRUCTURED";
      sections: Array<{
        id: string;
        /** Questions offered. */
        questions: number;
        /** Questions the candidate answers (all of them when nothing is chosen). */
        choose: number;
        totalMarks: number;
      }>;
    };

export interface OfficialPaper {
  paperNumber: 1 | 2;
  grade: number;
  description: string;
  durationMinutes: number;
  marks: number;
  structure: PaperStructure;
  citation: Citation;
}

export interface OfficialStructure {
  documentTitle: string;
  papers: OfficialPaper[];
  /** The specification grid for each paper. */
  proportions: Record<1 | 2, Proportions>;
}

const choiceStructure = z
  .object({
    question_type: z.literal("MULTIPLE_CHOICE"),
    question_count: z.number().int().positive(),
    marks_each: z.number().int().positive(),
  })
  .loose();

const sectionStructure = z
  .object({
    id: z.string(),
    approximate_questions: z.number().int().positive().optional(),
    questions: z.number().int().positive().optional(),
    choose: z.number().int().positive().optional(),
    total_marks: z.number().int().positive(),
  })
  .loose();

const structuredStructure = z
  .object({
    question_type: z.literal("STRUCTURED"),
    sections: z.array(sectionStructure).min(1),
  })
  .loose();

/** The prose-stated structure of a paper, strictly: anything unfamiliar is an error, not a guess. */
export function parsePaperStructure(raw: unknown): PaperStructure {
  const choice = choiceStructure.safeParse(raw);
  if (choice.success)
    return {
      kind: "CHOICE",
      questions: choice.data.question_count,
      marksEach: choice.data.marks_each,
    };
  const structured = structuredStructure.safeParse(raw);
  if (structured.success)
    return {
      kind: "STRUCTURED",
      sections: structured.data.sections.map((s) => {
        const questions = s.questions ?? s.approximate_questions;
        if (!questions)
          throw new Error(`Paper section ${s.id} says nothing about how many questions`);
        return { id: s.id, questions, choose: s.choose ?? questions, totalMarks: s.total_marks };
      }),
    };
  throw new Error("The syllabus describes a paper this program does not know how to build.");
}

function check(structure: OfficialStructure): OfficialStructure {
  for (const number of [1, 2] as const) {
    const grid = structure.proportions[number];
    const sum = BANDS.reduce((n, band) => n + grid[band], 0);
    if (Math.abs(sum - 100) > 0.01)
      throw new Error(`The specification grid for Paper ${number} adds up to ${sum}, not 100`);
  }
  for (const number of [1, 2] as const)
    if (!structure.papers.some((p) => p.paperNumber === number))
      throw new Error(`The syllabus structure has no Paper ${number}`);
  return structure;
}

function toStructure(input: {
  documentTitle: string;
  papers: Array<{
    grade: number;
    paper_number: number;
    description: string;
    duration_minutes: number | null;
    marks: number;
    structure: unknown;
    page: number;
    label: string | null;
  }>;
  bands: Array<{ paper_number: number; code: SkillBand; percent: number }>;
}): OfficialStructure {
  const grid = (paper: 1 | 2): Proportions => {
    const out: Partial<Proportions> = {};
    for (const b of input.bands) if (b.paper_number === paper) out[b.code] = Number(b.percent);
    for (const band of BANDS)
      if (out[band] === undefined) throw new Error(`Paper ${paper} has no grid share for ${band}`);
    return out as Proportions;
  };
  return check({
    documentTitle: input.documentTitle,
    papers: input.papers
      .filter((p) => p.paper_number === 1 || p.paper_number === 2)
      .map((p) => ({
        paperNumber: p.paper_number as 1 | 2,
        grade: p.grade,
        description: p.description,
        durationMinutes: p.duration_minutes ?? 120,
        marks: p.marks,
        structure: parsePaperStructure(p.structure),
        citation: { page: p.page, label: p.label },
      })),
    proportions: { 1: grid(1), 2: grid(2) },
  });
}

/** From a curriculum snapshot (tests, offline tools). */
export function structureFromSnapshot(snapshot: CurriculumSnapshot): OfficialStructure {
  const { papers, skill_bands } = snapshot.assessment;
  return toStructure({
    documentTitle: snapshot.document.title,
    papers: papers.map((p) => ({
      grade: p.grade,
      paper_number: p.paper_number,
      description: p.description,
      duration_minutes: p.duration_minutes,
      marks: p.marks,
      structure: p.structure,
      page: p.source.page,
      label: p.source.page_label,
    })),
    bands: skill_bands.map((b) => ({
      paper_number: b.paper_number,
      code: b.skill_band_code,
      percent: b.percent,
    })),
  });
}

const paperRow = z.object({
  grade: z.number().int(),
  paper_number: z.number().int(),
  description: z.string(),
  duration_minutes: z.number().int().nullable(),
  marks: z.number().int(),
  structure: z.unknown(),
  source_page: z.number().int(),
  source_page_label: z.string().nullable(),
});
const bandRow = z.object({
  paper_number: z.number().int(),
  skill_band_code: z.enum(BANDS),
  percent: z.coerce.number(),
});

/** From the database (the running application). Readable by any signed-in user. */
export async function loadStructure(db: SupabaseClient): Promise<OfficialStructure> {
  const [papers, bands, document] = await Promise.all([
    db
      .from("assessment_papers")
      .select(
        "grade, paper_number, description, duration_minutes, marks, structure, source_page, source_page_label",
      ),
    db.from("assessment_skill_bands").select("paper_number, skill_band_code, percent"),
    db.from("curriculum_documents").select("title").limit(1).maybeSingle(),
  ]);
  for (const result of [papers, bands, document])
    if (result.error)
      throw new Error(`Could not read the examination structure: ${result.error.message}`);
  return toStructure({
    documentTitle: (document.data?.title as string | undefined) ?? "the syllabus",
    papers: (papers.data ?? []).map((p) => {
      const row = paperRow.parse(p);
      return {
        grade: row.grade,
        paper_number: row.paper_number,
        description: row.description,
        duration_minutes: row.duration_minutes,
        marks: row.marks,
        structure: row.structure,
        page: row.source_page,
        label: row.source_page_label,
      };
    }),
    bands: (bands.data ?? []).map((b) => {
      const row = bandRow.parse(b);
      return { paper_number: row.paper_number, code: row.skill_band_code, percent: row.percent };
    }),
  });
}
