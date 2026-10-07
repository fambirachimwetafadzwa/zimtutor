import type { Item } from "../../src/ingestion/tables";

/** A synthetic positioned item, defaulting to a top-level bullet at x=100 on page 1. */
export function item(overrides: Partial<Item> & { text: string }): Item {
  return {
    kind: "li",
    level: 0,
    label: "•",
    sourceText: overrides.text,
    lines: [overrides.text],
    normalizations: [],
    page: 1,
    x0: 100,
    textX0: 112,
    top: 0,
    bottom: 10,
    bold: false,
    hasFormula: false,
    onlyFormula: false,
    hasSubscript: false,
    mcids: [],
    ...overrides,
  };
}

/** A bullet, a plain paragraph, and a dash sub-item, at conventional positions. */
export const bullet = (text: string, extra: Partial<Item> = {}) => item({ text, ...extra });
export const para = (text: string, extra: Partial<Item> = {}) =>
  item({ kind: "p", label: "", x0: 100, textX0: 100, text, ...extra });
export const indentedPara = (text: string, extra: Partial<Item> = {}) =>
  para(text, { x0: 118, textX0: 118, ...extra });
export const dash = (text: string, extra: Partial<Item> = {}) =>
  item({ text, label: "-", level: 1, x0: 130, textX0: 142, ...extra });
