import type { Item } from "./tables";

/**
 * Items → bullets.
 *
 * A printed bullet can be made of several tagged pieces: wrapped lines the producer tagged as
 * separate paragraphs, worked examples under it, dash sub-lists, or a tail that spilled onto the
 * next page. This module merges those pieces back into the bullet the author wrote, using layout
 * (indentation relative to the bullet) rather than guessing from text. Text is never dropped:
 * everything handed in ends up in exactly one bullet.
 */

export interface Bullet {
  /** Flattened, single-line reading of the bullet. */
  text: string;
  /** Verbatim lines (paragraph breaks preserved as newlines). */
  sourceText: string;
  normalizations: string[];
  page: number;
  pageEnd: number;
  items: Item[];
  hasFormula: boolean;
  hasSubscript: boolean;
}

/** A line indented by more than this (points) beyond the bullet's left edge continues that bullet. */
const CONTINUATION_INDENT = 2;

const DASH_LABEL = /^[-–—]$/;
const DASH_PREFIX = /^[-–—]\s*/;

interface Builder {
  head: Item;
  parts: string[];
  sourceParts: string[];
  subItems: string[];
  normalizations: Set<string>;
  items: Item[];
  pageEnd: number;
}

/** Plain bullet glyphs carry no information; ordering labels such as "i)" or "(b)" do, so they stay in the source text. */
const BULLET_GLYPH = /^[•·▪●○◦■□\u2022\u25cf\u25aa\uf0b7\uf0a7-]$/u;

function labelled(item: Item): string {
  return item.label !== "" && !BULLET_GLYPH.test(item.label)
    ? `${item.label} ${item.sourceText}`
    : item.sourceText;
}

function startBuilder(item: Item): Builder {
  return {
    head: item,
    parts: [item.text],
    sourceParts: [labelled(item)],
    subItems: [],
    normalizations: new Set(item.normalizations),
    items: [item],
    pageEnd: item.page,
  };
}

function absorb(builder: Builder, item: Item, asSubItem: boolean): void {
  builder.items.push(item);
  builder.pageEnd = Math.max(builder.pageEnd, item.page);
  builder.sourceParts.push(item.label ? `${item.label} ${item.sourceText}` : item.sourceText);
  for (const n of item.normalizations) builder.normalizations.add(n);
  if (asSubItem) {
    builder.subItems.push(item.text.replace(DASH_PREFIX, "").trim());
  } else if (builder.subItems.length > 0) {
    // A plain line after a dash list is the wrapped end of the last dash item ("-irregular" / "shapes").
    const last = builder.subItems.length - 1;
    builder.subItems[last] = `${builder.subItems[last]} ${item.text}`.trim();
  } else {
    builder.parts.push(item.text);
  }
}

function finish(builder: Builder): Bullet {
  let text = builder.parts.join(" ").replace(/\s+/g, " ").trim();
  if (builder.subItems.length > 0) {
    text = withSubItems(text, builder.subItems);
  }
  return {
    text,
    sourceText: builder.sourceParts.join("\n").trim(),
    normalizations: [...builder.normalizations].sort(),
    page: builder.head.page,
    pageEnd: builder.pageEnd,
    items: builder.items,
    hasFormula: builder.items.some((i) => i.hasFormula),
    hasSubscript: builder.items.some((i) => i.hasSubscript),
  };
}

const NOTE = /^NB\b/i;

/** An "NB: ..." paragraph: a separate note the author added, never part of the bullet above it. */
function isNote(item: Item): boolean {
  return item.kind === "p" && NOTE.test(item.text);
}

/** Is this item a continuation of the bullet currently being built? */
function continues(builder: Builder, item: Item): boolean {
  if (item.kind === "li") {
    // A visible bullet always has a label glyph. A list item WITHOUT one is the second half of a bullet
    // the producer split across a page break, so it continues the bullet above.
    if (item.label === "") return true;
    // Nested or dash-labelled list items are sub-items of the current bullet.
    return item.level > 0 || DASH_LABEL.test(item.label);
  }
  // An "NB:" is a note in its own right, however it is indented or styled.
  if (isNote(item)) return false;
  // Top of a page after a row split: a paragraph that starts mid-sentence (lower case, a digit or
  // closing punctuation) finishes the sentence the previous page ended with — this is the only
  // signal in plain-text cells, which have no bullets to indent against.
  if (item.afterPageBreak && /^[a-z0-9),.;:\-–—]/.test(item.text)) return true;
  // A plain paragraph that starts mid-sentence (lower case or a digit) right after a BULLETED item can
  // only be that bullet's wrapped second line, even when the producer did not indent it.
  if (builder.head.kind === "li" && /^[a-z0-9]/.test(item.text)) return true;
  // Otherwise a paragraph continues the bullet when it sits indented relative to the bullet's own left
  // edge, or when it contains an equation (an equation line always belongs to the text above it).
  return item.hasFormula || item.x0 > builder.head.x0 + CONTINUATION_INDENT;
}

/** "Parent:" + ["a,", "b"] → "Parent: a, b" (trailing commas typed into the source are not doubled). */
export function withSubItems(parent: string, subItems: string[]): string {
  const list = subItems
    .map((s) => s.replace(/[,;]+\s*$/, "").trim())
    .filter(Boolean)
    .join(", ");
  const base = parent.trim();
  if (list === "") return base;
  return `${base}${base.endsWith(":") ? "" : ":"} ${list}`.trim();
}

export function toBullets(items: Item[]): Bullet[] {
  const bullets: Bullet[] = [];
  let current: Builder | null = null;
  for (const item of items) {
    if (item.text === "" && item.kind === "li") {
      // An empty bullet (a stray glyph with no text) carries nothing; the caller records a warning.
      continue;
    }
    if (current && continues(current, item)) {
      const asSub =
        (item.kind === "li" &&
          item.label !== "" &&
          (item.level > 0 || DASH_LABEL.test(item.label))) ||
        (item.kind === "p" && DASH_PREFIX.test(item.text) && item.text.length > 1);
      absorb(current, item, asSub);
      continue;
    }
    if (current) bullets.push(finish(current));
    current = startBuilder(item);
  }
  if (current) bullets.push(finish(current));
  return bullets;
}

/** Merge two bullets the source split mid-sentence; the second one's own bullet is kept in the source text. */
export function mergeBullets(a: Bullet, b: Bullet): Bullet {
  return {
    text: `${a.text} ${b.text}`.replace(/\s+/g, " ").trim(),
    sourceText: `${a.sourceText}\n• ${b.sourceText}`,
    normalizations: [
      ...new Set([...a.normalizations, ...b.normalizations, "REVIEWED_JOIN"]),
    ].sort(),
    page: a.page,
    pageEnd: Math.max(a.pageEnd, b.pageEnd),
    items: [...a.items, ...b.items],
    hasFormula: a.hasFormula || b.hasFormula,
    hasSubscript: a.hasSubscript || b.hasSubscript,
  };
}

export function countEmptyBullets(items: Item[]): number {
  return items.filter((i) => i.kind === "li" && i.text === "").length;
}
