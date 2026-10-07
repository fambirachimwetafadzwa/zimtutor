import type { Run } from "./pdf";

/**
 * Text assembly: a list of runs → clean text, with an honest record of anything normalised.
 *
 * `sourceText` is what the PDF literally contains (superscript digits appear as ordinary digits:
 * "cm2"). `text` is the cleaned reading ("cm²"). Whenever they differ, `normalizations` says why,
 * so the original is always recoverable and the change is auditable.
 */

export interface AssembledText {
  text: string;
  sourceText: string;
  /** Visual lines (verbatim, whitespace-collapsed), used for multi-line source text. */
  lines: string[];
  normalizations: string[];
  hasFormula: boolean;
  /** A lowered (subscript) run was seen: not expected in this syllabus, so it must be reviewed. */
  hasSubscript: boolean;
}

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "−": "⁻",
};

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The most common text size by character count: the item's typical line height (used for line breaks). */
function modeSize(runs: Run[]): number {
  const weight = new Map<number, number>();
  for (const r of runs) {
    const key = Math.round(r.size * 10) / 10;
    weight.set(key, (weight.get(key) ?? 0) + r.text.trim().length);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [size, w] of weight) {
    if (w > bestWeight || (w === bestWeight && size > best)) {
      best = size;
      bestWeight = w;
    }
  }
  return best;
}

/**
 * The body size of an item is its LARGEST text size: raised/lowered (super/subscript) runs are always
 * smaller than the text they belong to, so they can never be mistaken for the reference — even when
 * they outnumber the body text ("5" + "th").
 */
function bodySize(runs: Run[]): number {
  return runs.reduce((max, r) => (r.text.trim() !== "" && r.size > max ? r.size : max), 0);
}

export function assembleText(runs: Run[]): AssembledText {
  const visible = runs.filter((r) => r.text !== "");
  if (visible.length === 0) {
    return {
      text: "",
      sourceText: "",
      lines: [],
      normalizations: [],
      hasFormula: false,
      hasSubscript: false,
    };
  }
  const reference = bodySize(visible); // for super/subscript detection
  const lineHeight = modeSize(visible.filter((r) => r.text.trim() !== "")); // for line breaks
  const normalizations = new Set<string>();
  let hasSubscript = false;

  let text = "";
  let source = "";
  const lines: string[] = [];
  let currentLine = "";
  let baseBaseline: number | null = null;

  for (const run of visible) {
    // Equation runs are never interpreted as super/subscripts: their extraction is unreliable by
    // definition and is replaced by a reviewed correction (see overrides.ts).
    const small = !run.formula && reference > 0 && run.size < reference * 0.85;
    const raised = small && baseBaseline !== null && run.baseline < baseBaseline - 0.25 * reference;
    const lowered = small && baseBaseline !== null && run.baseline > baseBaseline + 0.1 * reference;

    if (raised) {
      const t = run.text.trim();
      if (t === "") {
        // A space typeset in the small raised font (right after "cm³"): just a space.
        text += run.text;
        source += run.text;
        currentLine += run.text;
        continue;
      }
      const mapped = [...t].every((ch) => ch in SUPERSCRIPT);
      if (mapped && t !== "") {
        text += [...t].map((ch) => SUPERSCRIPT[ch]).join("");
        normalizations.add("SUPERSCRIPT");
      } else {
        text += `^(${t})`;
        normalizations.add("SUPERSCRIPT_UNMAPPED");
      }
      source += run.text;
      currentLine += run.text;
      continue;
    }
    if (lowered) hasSubscript = true;

    // A new visual line: the baseline moved by more than half a line from the previous normal run.
    if (
      baseBaseline !== null &&
      Math.abs(run.baseline - baseBaseline) > 0.6 * (lineHeight || run.size)
    ) {
      lines.push(collapse(currentLine));
      currentLine = "";
      text += " ";
      source += " ";
    }
    if (!small) baseBaseline = run.baseline;
    else if (baseBaseline === null) baseBaseline = run.baseline;

    text += run.text;
    source += run.text;
    currentLine += run.text;
  }
  lines.push(collapse(currentLine));

  return {
    text: collapse(text),
    sourceText: collapse(source),
    lines: lines.filter((l) => l !== ""),
    normalizations: [...normalizations].sort(),
    hasFormula: visible.some((r) => r.formula),
    hasSubscript,
  };
}
