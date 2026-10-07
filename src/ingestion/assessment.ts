import type { PdfDocument } from "./pdf";
import type { CurriculumSnapshot, Source } from "./snapshot";
import { assembleText } from "./text";
import type { Block, Item, Ledger, TableBlock } from "./tables";

/**
 * Assessment (syllabus section 9): weightings, paper structure, specification grid, project
 * scheme and assessment objectives — extracted from the document, never typed into code.
 *
 * The tables are parsed from the structure tree and their facts cross-checked arithmetically
 * (weights sum to 100, marks sum to the stated totals). Facts stated only in prose are matched with
 * strict patterns; if a pattern stops matching, extraction fails loudly rather than guessing.
 */

export type AssessmentRecords = CurriculumSnapshot["assessment"];

interface Context {
  documentId: string;
  pageLabels: Map<number, string | null>;
}

function pct(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*%$/.exec(text.trim());
  if (!m) throw new Error(`Expected a percentage but found ${JSON.stringify(text)}`);
  return Number(m[1]);
}

function int(text: string): number {
  if (!/^\d+$/.test(text.trim()))
    throw new Error(`Expected a whole number but found ${JSON.stringify(text)}`);
  return Number(text.trim());
}

function rowTexts(table: TableBlock, section: "THead" | "TBody"): string[][] {
  return table.rows
    .filter((r) => r.section === section)
    .map((r) => r.cells.flatMap((c) => c.items.map((i) => i.text).filter((t) => t !== "")));
}

function allItems(table: TableBlock): Item[] {
  return table.rows.flatMap((r) => r.cells.flatMap((c) => c.items));
}

function claim(table: TableBlock, ledger: Ledger, owner: string): void {
  for (const item of allItems(table))
    for (const mcid of item.mcids) ledger.claim(item.page, mcid, owner);
}

function findTable(tables: TableBlock[], firstHeader: string, count: number): TableBlock {
  const found = tables.filter((t) => {
    const head = rowTexts(t, "THead")[0];
    return (
      head !== undefined &&
      head.length === count &&
      head[0]!.toLowerCase().startsWith(firstHeader.toLowerCase())
    );
  });
  if (found.length !== 1) {
    throw new Error(
      `Assessment: expected exactly one table headed "${firstHeader}" (${count} columns), found ${found.length}`,
    );
  }
  return found[0]!;
}

function source(ctx: Context, page: number, text: string): Source {
  return { page, page_end: null, page_label: ctx.pageLabels.get(page) ?? null, source_text: text };
}

/** Plain text of one page's body (no artifacts), for locating prose facts. */
function pageProse(pdf: PdfDocument, page: number): string {
  const p = pdf.pages[page - 1]!;
  return assembleText(p.runs.filter((r) => !r.artifact)).sourceText;
}

function must(pattern: RegExp, text: string, what: string): RegExpExecArray {
  const m = pattern.exec(text);
  if (!m)
    throw new Error(
      `Assessment: could not find ${what} in the syllabus text (pattern ${pattern}). The document may have changed.`,
    );
  return m;
}

const SKILL_BANDS: Array<{
  match: RegExp;
  code: "KNOWLEDGE_COMPREHENSION" | "APPLICATION_ANALYSIS" | "PROBLEM_SOLVING";
}> = [
  { match: /^knowledge and comprehension$/i, code: "KNOWLEDGE_COMPREHENSION" },
  { match: /^application and analysis$/i, code: "APPLICATION_ANALYSIS" },
  { match: /^problem solving$/i, code: "PROBLEM_SOLVING" },
];

export function extractAssessment(
  blocks: Block[],
  pdf: PdfDocument,
  ledger: Ledger,
  ctx: Context,
  /** Items the matrix extractor found after its table ended (the producer nested them there). */
  strayItems: Item[],
): AssessmentRecords {
  const tables = blocks.filter((b): b is TableBlock => b.kind === "table");

  // ── Components (20% / 80%) ────────────────────────────────────────────────────────────────
  const scheme = findTable(tables, "FORM OF ASSESSMENT", 2);
  claim(scheme, ledger, "assessment:components");
  const schemeRows = rowTexts(scheme, "TBody");
  const sbca = schemeRows.find((r) => /continuous assessment/i.test(r[0] ?? ""));
  const sa = schemeRows.find((r) => /^summative assessment/i.test(r[0] ?? ""));
  const total = schemeRows.find((r) => /^total/i.test(r[0] ?? ""));
  if (!sbca || !sa || !total)
    throw new Error("Assessment: the scheme table must have SBCA, Summative and Total rows");
  const sbcaPct = pct(sbca[1]!);
  const saPct = pct(sa[1]!);
  if (sbcaPct + saPct !== pct(total[1]!) || pct(total[1]!) !== 100) {
    throw new Error(
      `Assessment weights ${sbcaPct}% + ${saPct}% do not add up to the stated total ${total[1]}`,
    );
  }

  const prose81 = pageProse(pdf, 81);
  const prose82 = pageProse(pdf, 82);
  const perGrade = must(
    /one school-based project per grade which contributes to (\d+)% of the end of year final mark/i,
    prose81,
    "the per-grade project weighting",
  );
  const projectSa = must(
    /summative assessment shall then contribute (\d+)%/i,
    prose81,
    "the summative contribution",
  );
  const grade7 = must(
    /two \(2\) school\s*-\s*based projects shall be considered as School Based Continuous Assessment at Grade (\d+)/i,
    prose81,
    "the Grade 7 project arrangement",
  );
  const each = must(
    /Each will contribute (\d+)%/i,
    prose81,
    "the weighting of each Grade 7 project",
  );
  if (Number(perGrade[1]) !== sbcaPct || Number(projectSa[1]) !== saPct) {
    throw new Error("Assessment: prose weightings disagree with the scheme table");
  }
  if (Number(each[1]) * 2 !== sbcaPct)
    throw new Error("Assessment: the two Grade 7 projects must add up to the SBCA weighting");

  const components: AssessmentRecords["components"] = [
    {
      id: "SBCA",
      name: sbca[0]!,
      weighting_percent: sbcaPct,
      details: {
        projects_per_grade: 1,
        grade_with_two_projects: Number(grade7[1]),
        projects_at_that_grade: 2,
        weight_percent_each_of_two: Number(each[1]),
      },
      source: source(ctx, 81, `${sbca[0]} | ${sbca[1]}`),
    },
    {
      id: "SA",
      name: sa[0]!,
      weighting_percent: saPct,
      details: {},
      source: source(ctx, 81, `${sa[0]} | ${sa[1]}`),
    },
  ];

  // ── School-based project stages ───────────────────────────────────────────────────────────
  const projects = findTable(tables, "Project Execution Stages", 4);
  claim(projects, ledger, "assessment:project-stages");
  const stageRows = rowTexts(projects, "TBody");
  const stages: AssessmentRecords["project_stages"] = [];
  let marksTotal = 0;
  let statedTotal: number | null = null;
  for (const r of stageRows) {
    if (/^total$/i.test(r[0] ?? "")) {
      statedTotal = int(r[r.length - 1]!);
      continue;
    }
    if (r.length !== 4)
      throw new Error(
        `Assessment: a project stage row should have 4 cells, got ${JSON.stringify(r)}`,
      );
    const marks = int(r[3]!);
    marksTotal += marks;
    stages.push({
      id: `SBP-${int(r[0]!)}`,
      stage: int(r[0]!),
      description: r[1]!,
      timeline: r[2]!,
      marks,
      source: source(ctx, 81, r.join(" | ")),
    });
  }
  if (statedTotal === null || statedTotal !== marksTotal) {
    throw new Error(
      `Assessment: project stage marks add to ${marksTotal} but the table states ${statedTotal}`,
    );
  }

  // ── ZIMSEC papers ─────────────────────────────────────────────────────────────────────────
  const papersTable = findTable(tables, "Paper", 6);
  claim(papersTable, ledger, "assessment:papers");
  const paperRows = rowTexts(papersTable, "TBody");
  const gradeMatch = must(
    /public examination at Grade (\d+)/i,
    prose82,
    "the ZIMSEC examination grade",
  );
  const examGrade = Number(gradeMatch[1]);

  const paper1Prose = must(
    /Paper 1 \((\d+) marks\)\s*There are (\d+) questions and candidates are expected to answer all questions/i,
    prose82,
    "the Paper 1 description",
  );
  const sectionA = must(
    /Section A will consist approximately (\d+) structured questions\.\s*Candidates must answer all questions\.\s*The total for this section is (\d+) marks/i,
    prose82,
    "Paper 2 section A",
  );
  const sectionB = must(
    /Section B will consist of (\d+) structured questions worth (\d+) marks each\.\s*Candidates must choose and answer (\d+) questions\.\s*The total for this section is (\d+) marks/i,
    prose82,
    "Paper 2 section B",
  );

  const papers: AssessmentRecords["papers"] = [];
  let summativeStated: number | null = null;
  for (const r of paperRows) {
    // Row 1 carries the merged "Weighting %" cell (6 values); row 2 does not (5 values).
    if (r.length !== 5 && r.length !== 6)
      throw new Error(`Assessment: a paper row should have 5 or 6 cells, got ${JSON.stringify(r)}`);
    const durationMatch = /^(\d+)\s*hours?$/i.exec(r[2]!);
    if (!durationMatch)
      throw new Error(`Assessment: unreadable paper duration ${JSON.stringify(r[2])}`);
    if (r.length === 6) summativeStated = Number(r[5]);
    const paperNumber = int(r[0]!);
    papers.push({
      id: `ZIMSEC-G${examGrade}-P${paperNumber}`,
      grade: examGrade,
      paper_number: paperNumber,
      description: r[1]!,
      duration_minutes: Number(durationMatch[1]) * 60,
      marks: int(r[3]!),
      paper_weighting_percent: Number(r[4]),
      summative_weighting_percent: null,
      structure: {},
      source: source(ctx, 82, r.join(" | ")),
    });
  }
  if (papers.length !== 2) throw new Error(`Assessment: expected 2 papers, found ${papers.length}`);
  const paperWeights = papers.reduce((s, p) => s + p.paper_weighting_percent, 0);
  if (summativeStated === null || paperWeights !== summativeStated || summativeStated !== saPct) {
    throw new Error(
      `Assessment: paper weightings (${paperWeights}) must equal the merged summative weighting (${summativeStated}) and the scheme's ${saPct}%`,
    );
  }
  for (const p of papers) p.summative_weighting_percent = summativeStated;

  const [p1, p2] = papers as [(typeof papers)[number], (typeof papers)[number]];
  if (Number(paper1Prose[1]) !== p1.marks)
    throw new Error("Assessment: Paper 1 prose marks disagree with the table");
  p1.structure = {
    question_type: "MULTIPLE_CHOICE",
    question_count: Number(paper1Prose[2]),
    answer: "all",
    marks_each: p1.marks / Number(paper1Prose[2]),
  };
  const aMarks = Number(sectionA[2]);
  const bMarks = Number(sectionB[4]);
  const bQuestions = Number(sectionB[1]);
  const bMarksEach = Number(sectionB[2]);
  const bChoose = Number(sectionB[3]);
  if (bChoose * bMarksEach !== bMarks)
    throw new Error("Assessment: Paper 2 section B marks are inconsistent");
  if (aMarks + bMarks !== p2.marks)
    throw new Error(
      `Assessment: Paper 2 sections add to ${aMarks + bMarks} but the paper has ${p2.marks} marks`,
    );
  p2.structure = {
    question_type: "STRUCTURED",
    sections: [
      { id: "A", approximate_questions: Number(sectionA[1]), answer: "all", total_marks: aMarks },
      {
        id: "B",
        questions: bQuestions,
        marks_each: bMarksEach,
        choose: bChoose,
        total_marks: bMarks,
      },
    ],
  };

  // ── Specification grid ────────────────────────────────────────────────────────────────────
  const grid = findTable(tables, "Skill", 3);
  claim(grid, ledger, "assessment:specification-grid");
  const bands: AssessmentRecords["skill_bands"] = [];
  const bandSums = [0, 0];
  for (const r of rowTexts(grid, "TBody")) {
    if (/^total$/i.test(r[0] ?? "")) {
      if (pct(r[1]!) !== 100 || pct(r[2]!) !== 100)
        throw new Error("Assessment: the specification grid does not total 100%");
      continue;
    }
    const band = SKILL_BANDS.find((b) => b.match.test(r[0] ?? ""));
    if (!band || r.length !== 3)
      throw new Error(`Assessment: unrecognised specification-grid row ${JSON.stringify(r)}`);
    for (const paperNumber of [1, 2] as const) {
      const percent = pct(r[paperNumber]!);
      bandSums[paperNumber - 1]! += percent;
      bands.push({
        id: `P${paperNumber}-${band.code}`,
        paper_number: paperNumber,
        skill_band: r[0]!,
        skill_band_code: band.code,
        percent,
        source: source(ctx, 82, r.join(" | ")),
      });
    }
  }
  if (bands.length !== 6 || bandSums[0] !== 100 || bandSums[1] !== 100) {
    throw new Error(
      `Assessment: specification grid bands are incomplete or do not sum to 100% per paper (${bandSums.join(", ")})`,
    );
  }

  // ── Assessment objectives 9.1.x ───────────────────────────────────────────────────────────
  const objectiveItems = strayItems.filter((i) => /^9\.1\.\d+$/.test(i.label));
  for (const item of objectiveItems)
    for (const mcid of item.mcids) ledger.claim(item.page, mcid, "assessment:objectives");
  const objectives: AssessmentRecords["objectives"] = objectiveItems
    .sort((a, b) => a.top - b.top)
    .map((item, i) => ({
      id: `AO-${item.label}`,
      code: item.label,
      ordinal: i + 1,
      text: item.text,
      source: source(ctx, item.page, `${item.label} ${item.sourceText}`),
    }));
  objectives.forEach((o, i) => {
    if (o.code !== `9.1.${i + 1}`)
      throw new Error(
        `Assessment objectives are not a contiguous 9.1.1.. sequence (got ${o.code} at position ${i + 1})`,
      );
  });
  if (objectives.length < 5)
    throw new Error(`Assessment: found only ${objectives.length} assessment objectives (9.1.x)`);

  return { components, papers, skill_bands: bands, objectives, project_stages: stages };
}
