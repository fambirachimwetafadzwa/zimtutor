import {
  isContent,
  type PdfDocument,
  type PdfPage,
  type Run,
  type TreeChild,
  type TreeNode,
} from "./pdf";
import { assembleText } from "./text";

/**
 * Structure walker: pages → headings and (page-stitched) tables whose cells hold list items.
 *
 * Everything text-bearing that this module hands out has its marked-content ids recorded in a
 * Ledger. The validator later requires that every body-text run in the matrix pages is owned by
 * something; that is how "nothing was silently dropped" is proven rather than assumed.
 */

export interface Item {
  kind: "li" | "p";
  /** List nesting depth: 0 for paragraphs and top-level bullets, 1+ for nested lists. */
  level: number;
  /** The bullet / numbering text ("•", "-", "9.1.1"); empty for paragraphs. */
  label: string;
  text: string;
  sourceText: string;
  lines: string[];
  normalizations: string[];
  page: number;
  /** Left edge of label + text. */
  x0: number;
  /** Left edge of the body text only (after the bullet). */
  textX0: number;
  top: number;
  bottom: number;
  bold: boolean;
  hasFormula: boolean;
  /** Every visible run is part of a Word equation: such a line always continues the text above it. */
  onlyFormula: boolean;
  hasSubscript: boolean;
  /** Set when this is the first item of a column at the top of a page, directly after a row split. */
  afterPageBreak?: boolean;
  mcids: number[];
}

export interface Cell {
  role: string;
  items: Item[];
}

export interface Row {
  section: string;
  cells: Cell[];
}

export interface HeadingBlock {
  kind: "heading";
  level: number;
  text: string;
  page: number;
  top: number;
  mcids: number[];
}

export interface TableBlock {
  kind: "table";
  rows: Row[];
  /** Pages the table has content on, ascending. */
  pages: number[];
  /** First page and vertical position of the table's own content. */
  startPage: number;
  /** The nearest heading before this table in document order. */
  heading: HeadingBlock | null;
}

/** A paragraph or list outside any table. */
export interface TextBlock {
  kind: "text";
  items: Item[];
  page: number;
  top: number;
  mcids: number[];
}

export type Block = HeadingBlock | TableBlock | TextBlock;

/** Who accounted for a marked-content block. */
export class Ledger {
  private readonly owners = new Map<string, string>();

  private key(page: number, mcid: number): string {
    return `${page}:${mcid}`;
  }

  owner(page: number, mcid: number): string | undefined {
    return this.owners.get(this.key(page, mcid));
  }

  /** Record an owner. Claiming the same block twice is a bug (duplicated text), so it throws. */
  claim(page: number, mcid: number, owner: string): void {
    const key = this.key(page, mcid);
    const existing = this.owners.get(key);
    if (existing !== undefined && existing !== owner) {
      throw new Error(
        `Page ${page} marked-content ${mcid} claimed by both "${existing}" and "${owner}"`,
      );
    }
    this.owners.set(key, owner);
  }

  /** Release a claim (used when a provisional owner is replaced by a more specific one). */
  release(page: number, mcid: number): void {
    this.owners.delete(this.key(page, mcid));
  }
}

type RunIndex = Map<number, Run[]>;

function indexRuns(page: PdfPage): RunIndex {
  const index: RunIndex = new Map();
  for (const run of page.runs) {
    if (run.mcid === null || run.artifact) continue;
    const list = index.get(run.mcid);
    if (list) list.push(run);
    else index.set(run.mcid, [run]);
  }
  return index;
}

function mcidsUnder(node: TreeChild, into: number[] = [], skipRoles?: Set<string>): number[] {
  if (isContent(node)) {
    into.push(node.mcid);
    return into;
  }
  if (skipRoles?.has(node.role)) return into;
  for (const child of node.children) mcidsUnder(child, into, skipRoles);
  return into;
}

function runsFor(mcids: number[], index: RunIndex): Run[] {
  const runs: Run[] = [];
  const seen = new Set<number>();
  for (const id of mcids) {
    if (seen.has(id)) continue;
    seen.add(id);
    runs.push(...(index.get(id) ?? []));
  }
  return runs.sort((a, b) => a.order - b.order);
}

function geometry(runs: Run[]): { x0: number; top: number; bottom: number } {
  const visible = runs.filter((r) => r.text.trim() !== "");
  if (visible.length === 0) return { x0: -1, top: -1, bottom: -1 };
  return {
    x0: Math.min(...visible.map((r) => r.x)),
    top: Math.min(...visible.map((r) => r.baseline - r.size)),
    bottom: Math.max(...visible.map((r) => r.baseline)),
  };
}

function makeItem(
  kind: "li" | "p",
  level: number,
  labelRuns: Run[],
  bodyRuns: Run[],
  mcids: number[],
  page: number,
): Item {
  const body = assembleText(bodyRuns);
  const label = assembleText(labelRuns).text;
  const all = geometry([...labelRuns, ...bodyRuns]);
  const bodyGeo = geometry(bodyRuns);
  const visible = bodyRuns.filter((r) => r.text.trim() !== "");
  return {
    kind,
    level,
    label,
    text: body.text,
    sourceText: body.sourceText,
    lines: body.lines,
    normalizations: body.normalizations,
    page,
    x0: all.x0,
    textX0: bodyGeo.x0,
    top: all.top,
    bottom: all.bottom,
    bold: visible.length > 0 && visible.every((r) => r.bold),
    hasFormula: body.hasFormula,
    onlyFormula: visible.length > 0 && visible.every((r) => r.formula),
    hasSubscript: body.hasSubscript,
    mcids,
  };
}

const TEXT_ROLES = new Set([
  "P",
  "Span",
  "Formula",
  "Figure",
  "Link",
  "H1",
  "H2",
  "H3",
  "H4",
  "Lbl",
  "LBody",
]);

/** Flatten a cell (or any container) into bullet / paragraph items, in document order. */
export function itemsOf(
  node: TreeNode,
  page: PdfPage,
  index: RunIndex,
  level = 0,
  out: Item[] = [],
): Item[] {
  const role = node.role;
  if (role === "L") {
    for (const child of node.children)
      if (!isContent(child)) itemsOf(child, page, index, level + 1, out);
    return out;
  }
  if (role === "LI") {
    let lbl: TreeNode | undefined;
    let body: TreeNode | undefined;
    for (const child of node.children) {
      if (isContent(child)) continue;
      if (child.role === "Lbl") lbl = child;
      else if (child.role === "LBody") body = child;
    }
    if (body) {
      // Text of the body EXCLUDING nested lists; nested lists become their own (deeper) items.
      const nested = new Set<TreeNode>();
      const direct: number[] = [];
      for (const child of body.children) {
        if (!isContent(child) && child.role === "L") nested.add(child);
        else mcidsUnder(child, direct);
      }
      const labelMcids = lbl ? mcidsUnder(lbl) : [];
      const bodyRuns = runsFor(direct, index);
      const labelRuns = runsFor(labelMcids, index);
      out.push(
        makeItem(
          "li",
          level - 1 < 0 ? 0 : level - 1,
          labelRuns,
          bodyRuns,
          [...labelMcids, ...direct],
          page.page,
        ),
      );
      for (const child of nested) itemsOf(child, page, index, level, out);
    }
    return out;
  }
  if (TEXT_ROLES.has(role)) {
    const mcids = mcidsUnder(node);
    const runs = runsFor(mcids, index);
    if (runs.some((r) => r.text.trim() !== ""))
      out.push(makeItem("p", level, [], runs, mcids, page.page));
    return out;
  }
  for (const child of node.children) if (!isContent(child)) itemsOf(child, page, index, level, out);
  return out;
}

function headingBlock(node: TreeNode, page: PdfPage, index: RunIndex): HeadingBlock {
  const mcids = mcidsUnder(node);
  const runs = runsFor(mcids, index);
  const assembled = assembleText(runs);
  const geo = geometry(runs);
  return {
    kind: "heading",
    level: Number(node.role.slice(1)),
    text: assembled.text,
    page: page.page,
    top: geo.top,
    mcids,
  };
}

function tableRows(table: TreeNode, page: PdfPage, index: RunIndex): Row[] {
  const rows: Row[] = [];
  const pushRow = (section: string, tr: TreeNode) => {
    const cells: Cell[] = [];
    for (const cell of tr.children) {
      if (isContent(cell)) continue;
      cells.push({ role: cell.role, items: itemsOf(cell, page, index) });
    }
    rows.push({ section, cells });
  };
  for (const part of table.children) {
    if (isContent(part)) continue;
    if (part.role === "THead" || part.role === "TBody" || part.role === "TFoot") {
      for (const tr of part.children)
        if (!isContent(tr) && tr.role === "TR") pushRow(part.role, tr);
    } else if (part.role === "TR") {
      pushRow("TR", part);
    }
  }
  return rows;
}

interface PageBlock {
  kind: "heading" | "table" | "text";
  node: TreeNode;
}

/** Structural wrappers that only group other elements and carry no text of their own. */
const CONTAINERS = new Set(["Root", "Document", "Part", "Art", "Sect", "Div", "NonStruct"]);

/**
 * Headings, tables and other text-bearing elements of one page in document order. Tables are not
 * descended into. Text elements are recorded so a table that merely FOLLOWS a paragraph is never
 * mistaken for the continuation of the previous page's table.
 */
function pageBlocks(node: TreeNode, out: PageBlock[] = []): PageBlock[] {
  for (const child of node.children) {
    if (isContent(child)) continue;
    if (/^H[1-6]$/.test(child.role)) out.push({ kind: "heading", node: child });
    else if (child.role === "Table") out.push({ kind: "table", node: child });
    else if (CONTAINERS.has(child.role)) pageBlocks(child, out);
    else if (mcidsUnder(child).length > 0) out.push({ kind: "text", node: child });
  }
  return out;
}

/**
 * Walk the whole document and return headings and tables in document order.
 * Tables that continue across pages (Word repeats the full table skeleton on each page it touches)
 * are stitched into one, merging rows by index.
 */
export function readBlocks(pdf: PdfDocument): Block[] {
  const blocks: Block[] = [];
  let lastHeading: HeadingBlock | null = null;
  let previousPageEndedWithTable: TableBlock | null = null;

  for (const page of pdf.pages) {
    const index = indexRuns(page);
    const onPage = pageBlocks(page.tree);
    let endedWithTable: TableBlock | null = null;

    onPage.forEach((block, position) => {
      if (block.kind === "text") {
        endedWithTable = null; // text after a table: the table did not run to the end of the page
        const items = itemsOf(block.node, page, index);
        const mcids = mcidsUnder(block.node);
        if (items.length > 0) {
          const geo = geometry(runsFor(mcids, index));
          blocks.push({ kind: "text", items, page: page.page, top: geo.top, mcids });
        }
        return;
      }
      if (block.kind === "heading") {
        const heading = headingBlock(block.node, page, index);
        endedWithTable = null;
        if (heading.text === "") return; // an empty heading element carries no text and has no position
        blocks.push(heading);
        lastHeading = heading;
        return;
      }
      const rows = tableRows(block.node, page, index);
      const isContinuation = position === 0 && previousPageEndedWithTable !== null;
      if (isContinuation) {
        const table: TableBlock = previousPageEndedWithTable!;
        if (table.rows.length !== rows.length) {
          throw new Error(
            `Table continuing onto page ${page.page} has ${rows.length} rows but ${table.rows.length} before: cannot stitch`,
          );
        }
        rows.forEach((row, r) => {
          const target = table.rows[r]!;
          if (target.cells.length !== row.cells.length) {
            throw new Error(
              `Row ${r} of the table continuing onto page ${page.page} changed its cell count`,
            );
          }
          row.cells.forEach((cell, c) => target.cells[c]!.items.push(...cell.items));
        });
        if (!table.pages.includes(page.page)) table.pages.push(page.page);
        endedWithTable = table;
      } else {
        const table: TableBlock = {
          kind: "table",
          rows,
          pages: [page.page],
          startPage: page.page,
          heading: lastHeading,
        };
        blocks.push(table);
        endedWithTable = table;
      }
    });
    previousPageEndedWithTable = endedWithTable;
  }
  return blocks;
}

/** All body text (non-artifact) runs of a page that carry visible text. */
export function bodyRuns(page: PdfPage): Run[] {
  return page.runs.filter((r) => !r.artifact && r.text.trim() !== "");
}
