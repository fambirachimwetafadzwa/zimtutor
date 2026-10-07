import { createHash } from "node:crypto";

/**
 * Stable internal identifiers.
 *
 *   sub-topic:  G5-NUM-PROPER-FRACTIONS
 *   objective:  G5-NUM-PROPER-FRACTIONS-002
 *   row:        G5-NUM-PROPER-FRACTIONS.R1
 *   content:    G5-NUM-PROPER-FRACTIONS.R1:CON03
 *
 * They derive ONLY from the document's own structure (grade, topic, sub-topic wording, order), so
 * re-ingesting the same document always reproduces the same ids and learner progress stays attached.
 * They are application identifiers — never presented as official Ministry identifiers.
 */

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "or",
  "the",
  "to",
  "up",
  "where",
  "whose",
  "with",
]);

const MAX_SLUG_WORDS = 6;

/** Words of `text` as upper-case ASCII alphanumerics. */
function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/** Upper-case, hyphen-separated slug with filler words removed and a length cap. */
export function slugify(text: string): string {
  const all = words(text);
  const significant = all.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
  const chosen = (significant.length > 0 ? significant : all).slice(0, MAX_SLUG_WORDS);
  return chosen.join("-");
}

/** Lower-case hyphenated key that keeps every word: relates "the same" sub-topic across grades. */
export function strandKey(shortName: string): string {
  return words(shortName)
    .map((w) => w.toLowerCase())
    .join("-");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Hash of normalised wording, used to detect text drift under a stable id on re-ingestion. */
export function textHash(text: string): string {
  return sha256(text.normalize("NFC").replace(/\s+/g, " ").trim());
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function objectiveId(subtopicId: string, ordinalInSubtopic: number): string {
  return `${subtopicId}-${pad(ordinalInSubtopic, 3)}`;
}

export function rowId(subtopicId: string, ordinal: number): string {
  return `${subtopicId}.R${ordinal}`;
}

export function rowItemId(
  rowIdValue: string,
  kind: "CON" | "ACT" | "RES",
  ordinal: number,
): string {
  return `${rowIdValue}:${kind}${pad(ordinal, 2)}`;
}
