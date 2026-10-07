import { withSubItems } from "./bullets";
import { slugify, strandKey } from "./ids";
import type { Item } from "./tables";

/**
 * Sub-topic names.
 *
 * The first matrix column is irregular: a bold group heading above the name (once, in Grade 3),
 * names wrapped across paragraphs and pages, scope lines such as "(0 – 1 000 000)", dash lists
 * ("Rate: Distance, Speed, Time"), and cells that list TWO sub-topics with one set of objectives
 * (HCF / LCM). The composed `name` keeps all the printed wording; `shortName` is a derived label
 * (qualifiers removed) used for filters, slugs and cross-grade linking.
 */

export interface NameParts {
  /** Bold heading printed above the name in the first cell, if any. */
  group: string | null;
  /** Verbatim composed name: all entries joined by "; ". */
  name: string;
  entries: string[];
  /** DERIVED: name without trailing qualifiers ("(0–100 000)", ": including ..."). */
  shortName: string;
  slug: string;
  strand: string;
}

const DASH_LABEL = /^[-–—]$/;
const DASH_PREFIX = /^[-–—]\s*\S/;

function isBulletItem(item: Item): boolean {
  // An unlabelled list item is the wrapped second half of a bullet split across a page break.
  return (
    item.kind === "li" && item.level === 0 && item.label !== "" && !DASH_LABEL.test(item.label)
  );
}

/** The part of an entry before its first qualifier: "Proper Fractions (denominators 2 to 10)" → "Proper Fractions". */
export function shortOf(entry: string): string {
  const cut = entry.search(/[(:]/);
  const base = (cut > 0 ? entry.slice(0, cut) : entry)
    .replace(/[\s.,;:–—-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return base === "" ? entry.trim() : base;
}

export function composeSubtopicName(items: Item[]): NameParts {
  const usable = items.filter((i) => i.text !== "");
  let group: string | null = null;
  let rest = usable;
  const first = usable[0];
  if (first && usable.length >= 2 && first.bold && !usable.slice(1).some((i) => i.bold)) {
    group = first.text;
    rest = usable.slice(1);
  }

  const entries: Array<{ parts: string[]; subs: string[] }> = [];
  for (const item of rest) {
    const current = entries[entries.length - 1];
    const startsEntry = current === undefined || isBulletItem(item);
    if (startsEntry) {
      entries.push({ parts: [item.text], subs: [] });
      continue;
    }
    const isDash =
      (item.kind === "li" && DASH_LABEL.test(item.label)) ||
      (item.kind === "p" && DASH_PREFIX.test(item.text));
    if (isDash) {
      current.subs.push(item.text.replace(/^[-–—]\s*/, "").trim());
    } else if (current.subs.length > 0) {
      const last = current.subs.length - 1;
      current.subs[last] = `${current.subs[last]} ${item.text}`.trim();
    } else {
      current.parts.push(item.text);
    }
  }

  const rendered = entries
    .map((e) => withSubItems(e.parts.join(" ").replace(/\s+/g, " ").trim(), e.subs))
    .filter((t) => t !== "");
  const name = rendered.join("; ");
  // "Area" and "Area of" are one idea: a derived name that merely extends an earlier one adds nothing.
  const shorts = rendered.map(shortOf);
  const distinct = shorts.filter(
    (s, i) => !shorts.slice(0, i).some((p) => s.toLowerCase().startsWith(p.toLowerCase())),
  );
  const shortName = distinct.join(" and ");
  return {
    group,
    name,
    entries: rendered,
    shortName,
    slug: slugify([group, shortName].filter(Boolean).join(" ")),
    strand: strandKey(shortName),
  };
}

/** Is `candidate` the wrapped remainder of a name that was cut off at a page break? */
export function nameContinues(previousName: string, candidate: string): boolean {
  const prev = previousName.trim();
  const opens = (prev.match(/\(/g) ?? []).length;
  const closes = (prev.match(/\)/g) ?? []).length;
  if (opens > closes) return true; // "…(where the" / "HCF is less than 20)"
  if (/[:,;]$/.test(prev)) return true; // "Area of:" / "- rectangle,"
  const text = candidate.trim();
  if (/^[(\-–—,;:]/.test(text)) return true; // "(whose product is less than 100 000)"
  if (/^[a-z0-9]/.test(text)) return true; // starts mid-sentence
  return false;
}
