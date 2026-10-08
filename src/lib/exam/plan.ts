import {
  BANDS,
  type Citation,
  type OfficialStructure,
  type Proportions,
  type SkillBand,
} from "./structure";

/**
 * A practice paper's plan: how many questions, in which sections, worth how many marks, and in what
 * proportions the three skills of the specification grid are tested. Built from the official
 * structure of the Grade 7 papers; a SHORT paper is the same shape at half the size.
 *
 * Practice papers follow the official shape so that a child meets it before the exam. They are
 * ZimTutor's own, and a mark on one is a ZimTutor practice score, never a ZIMSEC result.
 */

export type PaperKind = "EXAM_STYLE_PAPER_1" | "EXAM_STYLE_PAPER_2";
export type PaperLength = "FULL" | "SHORT";
export const PAPER_LENGTHS: readonly PaperLength[] = ["FULL", "SHORT"];

export interface SectionPlan {
  id: string;
  label: string;
  /** Questions in the paper. */
  offered: number;
  /** Questions that count towards the mark (fewer than offered when the child chooses). */
  counted: number;
  /** Marks of each question offered, in order. A structured question has a part for every mark. */
  marks: number[];
}

export interface PaperPlan {
  kind: PaperKind;
  paperNumber: 1 | 2;
  length: PaperLength;
  title: string;
  sections: SectionPlan[];
  /** Marks that count: what the paper is marked out of. */
  countedMarks: number;
  /** The skill shares aimed for (the official grid unless an adult chose others). */
  proportions: Proportions;
  officialProportions: Proportions;
  recommendedMinutes: number;
  citation: Citation;
  documentTitle: string;
}

export const kindOf = (paperNumber: 1 | 2): PaperKind =>
  paperNumber === 1 ? "EXAM_STYLE_PAPER_1" : "EXAM_STYLE_PAPER_2";

/** `total` marks over `count` questions as evenly as possible, 3 and 2 alternating, never 0. */
export function distributeMarks(total: number, count: number): number[] {
  if (count < 1 || total < count) throw new RangeError("Every question needs at least one mark");
  const base = Math.floor(total / count);
  const extra = total - base * count;
  const marks = Array.from({ length: count }, () => base);
  // spread the extra marks through the section instead of bunching them at the start
  for (let i = 0; i < extra; i++) marks[Math.floor((i * count) / extra)]! += 1;
  return marks;
}

/** Is this a usable set of skill shares: three non-negative numbers adding up to 100? */
export function validateProportions(p: Proportions): string | null {
  for (const band of BANDS) {
    const value = p[band];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100)
      return "Each share must be a number from 0 to 100.";
  }
  const sum = BANDS.reduce((n, band) => n + p[band], 0);
  return Math.abs(sum - 100) > 0.5
    ? `The three shares must add up to 100 (they add up to ${sum}).`
    : null;
}

/** Whole numbers of items for each band, adding up exactly to `total` (largest remainder). */
export function bandCounts(total: number, proportions: Proportions): Record<SkillBand, number> {
  const exact = BANDS.map((band) => ({ band, value: (total * proportions[band]) / 100 }));
  const counts = Object.fromEntries(
    exact.map((e) => [e.band, Math.floor(e.value + 1e-9)]),
  ) as Record<SkillBand, number>;
  let left = total - BANDS.reduce((n, band) => n + counts[band], 0);
  const byRemainder = [...exact].sort(
    (a, b) => b.value - Math.floor(b.value) - (a.value - Math.floor(a.value)),
  );
  for (const e of byRemainder) {
    if (left <= 0) break;
    counts[e.band] += 1;
    left -= 1;
  }
  return counts;
}

export function buildPlan(
  structure: OfficialStructure,
  input: { paperNumber: 1 | 2; length: PaperLength; proportions?: Proportions },
): PaperPlan {
  const official = structure.papers.find(
    (p) =>
      p.paperNumber === input.paperNumber &&
      p.grade === Math.max(...structure.papers.map((q) => q.grade)),
  );
  if (!official) throw new Error(`There is no official Paper ${input.paperNumber} to follow`);
  const factor = input.length === "FULL" ? 1 : 0.5;
  const officialProportions = structure.proportions[input.paperNumber];
  const proportions = input.proportions ?? officialProportions;
  const problem = validateProportions(proportions);
  if (problem) throw new RangeError(problem);

  const sections: SectionPlan[] = [];
  if (official.structure.kind === "CHOICE") {
    const { questions: officialQuestions, marksEach } = official.structure;
    const questions = Math.max(1, Math.round(officialQuestions * factor));
    sections.push({
      id: "A",
      label: "Multiple choice",
      offered: questions,
      counted: questions,
      marks: Array.from({ length: questions }, () => marksEach),
    });
  } else {
    for (const s of official.structure.sections) {
      const offered = Math.max(1, Math.round(s.questions * factor));
      const counted =
        s.choose >= s.questions ? offered : Math.max(1, Math.round(s.choose * factor));
      // the marks of a section are for the questions that count: a section with a choice has equal questions
      const marks =
        s.choose >= s.questions
          ? distributeMarks(Math.max(offered, Math.round(s.totalMarks * factor)), offered)
          : Array.from({ length: offered }, () => Math.round(s.totalMarks / s.choose));
      sections.push({
        id: s.id,
        label:
          s.choose >= s.questions ? "Answer every question" : `Answer any ${counted} questions`,
        offered,
        counted,
        marks,
      });
    }
  }

  const countedMarks = sections.reduce((n, s) => {
    if (s.counted >= s.offered) return n + s.marks.reduce((a, b) => a + b, 0);
    return n + s.marks.slice(0, s.counted).reduce((a, b) => a + b, 0);
  }, 0);
  return {
    kind: kindOf(input.paperNumber),
    paperNumber: input.paperNumber,
    length: input.length,
    title: `Paper ${input.paperNumber}: ${official.description}`,
    sections,
    countedMarks,
    proportions,
    officialProportions,
    recommendedMinutes: Math.round(official.durationMinutes * factor),
    citation: official.citation,
    documentTitle: structure.documentTitle,
  };
}
