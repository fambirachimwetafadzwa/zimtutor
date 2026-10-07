import fs from "node:fs";
import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * PDF reading layer: PDF → a plain, serialisable model.
 *
 * The syllabus is a tagged PDF (Word export), so besides text with coordinates we read its logical
 * STRUCTURE TREE (tables → rows → cells → lists → items). The tree is the reliable source for
 * grouping text into cells and bullets; coordinates are used (elsewhere) to decide which printed
 * COLUMN a cell belongs to, because Word's merged/split cells make cell order unreliable.
 */

/** One text run (a contiguous piece of text drawn with one font and size). */
export interface Run {
  text: string;
  x: number;
  width: number;
  /** Baseline measured from the TOP of the page (y grows downwards). */
  baseline: number;
  /** Font size in points. */
  size: number;
  font: string;
  bold: boolean;
  /** Marked-content id of the innermost tagged block; links the run to the structure tree. */
  mcid: number | null;
  /** Decorative content (running header, page number): not part of the document body. */
  artifact: boolean;
  /** Inside a Word equation (/Formula element), whose extraction is unreliable. */
  formula: boolean;
  /** Position in the page's content stream (restores reading order from a set of MCIDs). */
  order: number;
}

export interface TreeNode {
  role: string;
  children: TreeChild[];
}
export type TreeChild = TreeNode | { mcid: number };

export function isContent(node: TreeChild): node is { mcid: number } {
  return "mcid" in node;
}

export interface PdfPage {
  page: number;
  width: number;
  height: number;
  runs: Run[];
  tree: TreeNode;
  /** Printed page number as it appears in the footer ("iii", "13"), if any. */
  label: string | null;
}

export interface PdfDocument {
  sha256: string;
  pageCount: number;
  pages: PdfPage[];
  info: { title: string | null; author: string | null };
}

interface RawTreeNode {
  role?: string;
  type?: string;
  id?: string;
  children?: RawTreeNode[];
}

interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

interface RawMarkedContent {
  type: string;
  id?: string | null;
  tag?: string;
}

const MCID_PATTERN = /_mc(\d+)$/;
const PAGE_LABEL_PATTERN = /^(?:[ivxlcdm]+|\d{1,3})$/i;

function normaliseTree(node: RawTreeNode): TreeChild | null {
  if (node.type === "content" && typeof node.id === "string") {
    const match = MCID_PATTERN.exec(node.id);
    return match ? { mcid: Number(match[1]) } : null;
  }
  if (typeof node.role !== "string") return null;
  const children: TreeChild[] = [];
  for (const child of node.children ?? []) {
    const normalised = normaliseTree(child);
    if (normalised) children.push(normalised);
  }
  return { role: node.role, children };
}

function collectMcids(node: TreeChild, into: Set<number>): void {
  if (isContent(node)) {
    into.add(node.mcid);
    return;
  }
  for (const child of node.children) collectMcids(child, into);
}

/** MCIDs that sit under a /Formula element (Word equations). */
function formulaMcids(node: TreeChild, into: Set<number> = new Set()): Set<number> {
  if (isContent(node)) return into;
  if (node.role === "Formula") collectMcids(node, into);
  else for (const child of node.children) formulaMcids(child, into);
  return into;
}

const BOLD = /bold|black|heavy|semibold|demi/i;

export async function readPdf(filePath: string): Promise<PdfDocument> {
  const bytes = fs.readFileSync(filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    verbosity: 0,
    // Real font names (needed to detect bold) are only exposed with this flag.
    fontExtraProperties: true,
  });
  const doc = await task.promise;

  const meta = (await doc.getMetadata().catch(() => null)) as {
    info?: Record<string, unknown>;
  } | null;
  const info = {
    title: typeof meta?.info?.Title === "string" ? meta.info.Title : null,
    author: typeof meta?.info?.Author === "string" ? meta.info.Author : null,
  };

  const fontNames = new Map<string, string>();
  const pages: PdfPage[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    await page.getOperatorList(); // loads the page's fonts so their names can be read
    const content = await page.getTextContent({ includeMarkedContent: true });
    const rawTree = (await page.getStructTree()) as RawTreeNode | null;

    const tree = (rawTree && (normaliseTree(rawTree) as TreeNode | null)) ?? {
      role: "Root",
      children: [],
    };
    const inFormula = formulaMcids(tree);

    const stack: Array<{ mcid: number | null; artifact: boolean }> = [];
    const runs: Run[] = [];

    for (const item of content.items as Array<RawTextItem | RawMarkedContent>) {
      if ("str" in item) {
        if (item.str === "") continue; // zero-width marker emitted by pdf.js
        let font = fontNames.get(item.fontName);
        if (font === undefined) {
          try {
            font = String(
              (page.commonObjs.get(item.fontName) as { name?: string } | undefined)?.name ?? "",
            );
          } catch {
            font = "";
          }
          fontNames.set(item.fontName, font);
        }
        let mcid: number | null = null;
        let artifact = false;
        for (let i = stack.length - 1; i >= 0; i--) {
          const entry = stack[i]!;
          if (mcid === null && entry.mcid !== null) mcid = entry.mcid;
          if (entry.artifact) artifact = true;
        }
        runs.push({
          text: item.str,
          x: item.transform[4] as number,
          width: item.width,
          baseline: viewport.height - (item.transform[5] as number),
          size: item.height,
          font,
          bold: BOLD.test(font),
          mcid,
          artifact,
          formula: mcid !== null && inFormula.has(mcid),
          order: runs.length,
        });
      } else if (item.type === "beginMarkedContentProps" || item.type === "beginMarkedContent") {
        const match = typeof item.id === "string" ? MCID_PATTERN.exec(item.id) : null;
        stack.push({ mcid: match ? Number(match[1]) : null, artifact: item.tag === "Artifact" });
      } else if (item.type === "endMarkedContent") {
        stack.pop();
      }
    }

    pages.push({
      page: pageNumber,
      width: viewport.width,
      height: viewport.height,
      runs,
      tree,
      label: findPageLabel(runs, viewport.height),
    });
    page.cleanup();
  }

  await task.destroy();
  return { sha256, pageCount: pages.length, pages, info };
}

/** The footer page number: an artifact run near the bottom that looks like a number or roman numeral. */
function findPageLabel(runs: Run[], pageHeight: number): string | null {
  const candidates = runs
    .filter(
      (r) => r.artifact && r.baseline > pageHeight * 0.85 && PAGE_LABEL_PATTERN.test(r.text.trim()),
    )
    .map((r) => r.text.trim());
  return candidates[0] ?? null;
}
