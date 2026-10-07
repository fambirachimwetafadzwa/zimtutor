import fs from "node:fs";
import { z } from "zod";
import { extractAssessment } from "./assessment";
import { readMatrixTables } from "./matrix";
import { loadOverrides, OverrideIndex } from "./overrides";
import { readPdf, type PdfDocument, type PdfPage } from "./pdf";
import { buildTableRecords, type UnreviewedNotation } from "./records";
import { readScopeSequence, readSections } from "./scope";
import {
  EXTRACTOR_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
  TOPIC_CODES,
  snapshotSchema,
  type CurriculumSnapshot,
} from "./snapshot";
import { Ledger, readBlocks } from "./tables";
import { assembleText } from "./text";

/**
 * The extraction pipeline: PDF → validated, provenance-rich snapshot.
 *
 *   identity check → read pages → structure (headings, tables) → matrix rows → records
 *   → scope/sequence → prose sections → assessment → text-conservation proof → snapshot
 *
 * `issues` are extraction-time findings (things only visible while the PDF is in hand, such as
 * "this text on page 41 was not accounted for"). The snapshot-only invariants live in validate.ts.
 */

export const manifestSchema = z
  .object({
    document_id: z.string(),
    title: z.string(),
    organisation: z.string(),
    curriculum_year: z.string(),
    subject: z.string(),
    grades: z.array(z.number().int()),
    source_type: z.literal("OFFICIAL_CURRICULUM"),
    verification_status: z.literal("VERIFIED_FROM_SOURCE"),
    file: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    page_count: z.number().int().positive(),
  })
  .passthrough();
export type Manifest = z.infer<typeof manifestSchema>;

export interface ExtractionIssue {
  code: string;
  message: string;
  page: number | null;
}

export interface ExtractionOptions {
  pdfPath: string;
  manifestPath: string;
  overridesPath: string;
}

export interface ExtractionResult {
  snapshot: CurriculumSnapshot;
  issues: ExtractionIssue[];
}

/** Pages that are fully structured body text: scope-and-sequence and the competency matrix. */
function conservationRange(firstSection: number, lastMatrixPage: number): [number, number] {
  return [firstSection, lastMatrixPage];
}

function pageText(page: PdfPage): string {
  // Group consecutive runs of the same marked-content block into one paragraph.
  const paragraphs: string[] = [];
  let group: PdfPage["runs"] = [];
  let groupKey: number | null | undefined;
  const flush = () => {
    if (group.length > 0) {
      const text = assembleText(group).sourceText;
      if (text !== "") paragraphs.push(text);
    }
    group = [];
  };
  for (const run of page.runs) {
    if (run.artifact) continue;
    const key = run.mcid;
    if (key !== groupKey) {
      flush();
      groupKey = key;
    }
    group.push(run);
  }
  flush();
  return paragraphs.join("\n");
}

function checkConservation(
  pdf: PdfDocument,
  ledger: Ledger,
  [from, to]: [number, number],
): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];
  for (let n = from; n <= to; n++) {
    const page = pdf.pages[n - 1]!;
    const unowned = new Map<string, number>();
    for (const run of page.runs) {
      if (run.artifact || run.text.trim() === "") continue;
      if (run.mcid === null) {
        unowned.set(
          `UNTAGGED: ${run.text.trim()}`,
          (unowned.get(`UNTAGGED: ${run.text.trim()}`) ?? 0) + 1,
        );
      } else if (ledger.owner(n, run.mcid) === undefined) {
        const key = `UNOWNED(mc ${run.mcid}): ${run.text.trim()}`;
        unowned.set(key, (unowned.get(key) ?? 0) + 1);
      }
    }
    if (unowned.size > 0) {
      issues.push({
        code: "TEXT_NOT_ACCOUNTED_FOR",
        message: `Page ${n} has text that no extractor accounted for: ${[...unowned.keys()].slice(0, 5).join(" | ")}`,
        page: n,
      });
    }
  }
  return issues;
}

export async function extractSnapshot(options: ExtractionOptions): Promise<ExtractionResult> {
  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(options.manifestPath, "utf8")));
  const pdf = await readPdf(options.pdfPath);
  const issues: ExtractionIssue[] = [];

  // ── Identity: refuse a different or modified document ────────────────────────────────────
  if (pdf.sha256 !== manifest.sha256) {
    throw new Error(
      `The PDF does not match the manifest (sha256 ${pdf.sha256} ≠ ${manifest.sha256}). Refusing to import it as ${manifest.source_type}. ` +
        `If this is a deliberately updated official document, update curriculum/source/manifest.json and review the result.`,
    );
  }
  if (pdf.pageCount !== manifest.page_count) {
    throw new Error(
      `The PDF has ${pdf.pageCount} pages but the manifest says ${manifest.page_count}`,
    );
  }
  const coverText = assembleText(pdf.pages[0]!.runs).sourceText.replace(/\s+/g, " ");
  if (!coverText.includes(manifest.title)) {
    throw new Error(`The cover page does not contain the manifest title "${manifest.title}"`);
  }

  const pageLabels = new Map(pdf.pages.map((p) => [p.page, p.label] as const));
  const ctx = { pageLabels };

  const blocks = readBlocks(pdf);
  const ledger = new Ledger();

  // Headings are structural; their text is part of what the validator accounts for.
  for (const block of blocks) {
    if (block.kind === "heading")
      for (const mcid of block.mcids) ledger.claim(block.page, mcid, "heading");
  }

  // ── Competency matrix ─────────────────────────────────────────────────────────────────────
  const overridesFile = loadOverrides(options.overridesPath);
  const overrides = new OverrideIndex(
    overridesFile.text_fixes,
    overridesFile.errata,
    overridesFile.joins,
  );
  const matrixTables = readMatrixTables(blocks, ledger);
  const seen = new Set<string>();
  const unreviewed: UnreviewedNotation[] = [];
  const records = matrixTables.map((table) => {
    const key = `G${table.heading.grade}-${table.heading.topic}`;
    if (seen.has(key)) throw new Error(`Duplicate competency matrix for ${key}`);
    seen.add(key);
    const result = buildTableRecords(table, { pageLabels, overrides });
    unreviewed.push(...result.unreviewed);
    return result;
  });
  records.sort(
    (a, b) =>
      a.topic.grade_id.localeCompare(b.topic.grade_id, undefined, { numeric: true }) ||
      TOPIC_CODES.indexOf(a.topic.code) - TOPIC_CODES.indexOf(b.topic.code),
  );

  for (const u of unreviewed) {
    issues.push({
      code: u.reason === "FORMULA" ? "UNREVIEWED_MATH_NOTATION" : "UNREVIEWED_SUBSCRIPT",
      message: `Page ${u.page} (${u.column}): "${u.source}" uses ${u.reason === "FORMULA" ? "a Word equation" : "subscript text"} and has no reviewed entry in the overrides file`,
      page: u.page,
    });
  }
  for (const fix of overrides.unused()) {
    issues.push({
      code: "STALE_OVERRIDE",
      message: `Override for page ${fix.page} ${JSON.stringify(fix.match)} matched nothing (the document or extractor changed)`,
      page: fix.page,
    });
  }

  for (const join of overrides.unusedJoins()) {
    issues.push({
      code: "STALE_JOIN",
      message: `Join for page ${join.page} ${JSON.stringify(join.first)} + ${JSON.stringify(join.second)} matched nothing (the document or extractor changed)`,
      page: join.page,
    });
  }
  for (const erratum of overrides.unusedErrata()) {
    issues.push({
      code: "STALE_ERRATUM",
      message: `Erratum for page ${erratum.page} ${JSON.stringify(erratum.match)} matched nothing (the document or extractor changed)`,
      page: erratum.page,
    });
  }

  // ── Scope & sequence, prose, assessment ───────────────────────────────────────────────────
  const scopeSequence = readScopeSequence(blocks, ledger, ctx);
  const sections = readSections(blocks, ledger, ctx);
  const strayItems = matrixTables.flatMap((t) => t.outOfWindow);
  const assessment = extractAssessment(
    blocks,
    pdf,
    ledger,
    { documentId: manifest.document_id, pageLabels },
    strayItems,
  );
  for (const item of strayItems) {
    if (item.text === "") continue; // an empty tagged element: nothing to account for
    const owner = item.mcids.length > 0 ? ledger.owner(item.page, item.mcids[0]!) : undefined;
    if (owner === undefined) {
      issues.push({
        code: "UNEXPECTED_OUT_OF_TABLE_TEXT",
        message: `Text on page ${item.page} was tagged into a table but lies beyond it, and is not an assessment objective: ${JSON.stringify(item.text.slice(0, 80))}`,
        page: item.page,
      });
    }
  }

  // ── Proof that nothing was silently dropped ───────────────────────────────────────────────
  const firstSection = blocks.find(
    (b) => b.kind === "heading" && /^7\s+SCOPE AND SEQUENCE/i.test(b.text),
  );
  const lastMatrixPage = Math.max(...matrixTables.flatMap((t) => t.pages));
  if (firstSection && firstSection.kind === "heading") {
    issues.push(
      ...checkConservation(pdf, ledger, conservationRange(firstSection.page, lastMatrixPage)),
    );
  } else {
    issues.push({
      code: "NO_SCOPE_SECTION",
      message: 'Could not find the "7 SCOPE AND SEQUENCE" heading',
      page: null,
    });
  }

  // ── Assemble ──────────────────────────────────────────────────────────────────────────────
  const grades = [...new Set(records.map((r) => r.topic.grade_id))].map((id) => ({
    id,
    number: Number(id.slice(1)),
    label: `Grade ${id.slice(1)}`,
  }));

  const snapshot = snapshotSchema.parse({
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    document: {
      id: manifest.document_id,
      title: manifest.title,
      organisation: manifest.organisation,
      curriculum_year: manifest.curriculum_year,
      source_type: manifest.source_type,
      verification_status: manifest.verification_status,
      sha256: pdf.sha256,
      page_count: pdf.pageCount,
      extractor_version: EXTRACTOR_VERSION,
      objective_stem: matrixTables[0]?.objectiveStem ?? "",
    },
    curriculum: {
      id: manifest.document_id,
      name: manifest.title,
      organisation: manifest.organisation,
      curriculum_year: manifest.curriculum_year,
      document_id: manifest.document_id,
    },
    subjects: [{ id: "MATH", name: manifest.subject }],
    grades,
    topics: records.map((r) => r.topic),
    subtopics: records.flatMap((r) => r.subtopics),
    competency_rows: records.flatMap((r) => r.rows),
    objectives: records.flatMap((r) => r.objectives),
    content: records.flatMap((r) => r.content),
    activities: records.flatMap((r) => r.activities),
    resources: records.flatMap((r) => r.resources),
    assessment,
    scope_sequence: scopeSequence,
    sections,
    pages: pdf.pages.map((p) => ({ page: p.page, page_label: p.label, text: pageText(p) })),
    warnings: records.flatMap((r) => r.warnings),
  });

  return { snapshot, issues };
}
