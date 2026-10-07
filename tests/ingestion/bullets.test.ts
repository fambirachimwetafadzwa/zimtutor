import { describe, expect, it } from "vitest";
import {
  countEmptyBullets,
  mergeBullets,
  toBullets,
  withSubItems,
} from "../../src/ingestion/bullets";
import { bullet, dash, indentedPara, item, para } from "./helpers";

describe("toBullets", () => {
  it("makes one bullet per labelled list item", () => {
    const out = toBullets([bullet("read numbers"), bullet("write numbers")]);
    expect(out.map((b) => b.text)).toEqual(["read numbers", "write numbers"]);
  });

  it("joins an indented wrapped line to the bullet above", () => {
    const out = toBullets([bullet("Quantifying"), indentedPara("0-1 000"), bullet("Comparisons")]);
    expect(out.map((b) => b.text)).toEqual(["Quantifying 0-1 000", "Comparisons"]);
  });

  it("keeps worked-example lines under the bullet that introduced them (verbatim lines preserved)", () => {
    const out = toBullets([
      bullet("Adding numbers for example"),
      indentedPara("462 + 27 = 489"),
      indentedPara("24 + 13=", { x0: 118 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("Adding numbers for example 462 + 27 = 489 24 + 13=");
    expect(out[0]!.sourceText).toBe("Adding numbers for example\n462 + 27 = 489\n24 + 13=");
  });

  it("treats plain paragraphs in a cell with no bullets as separate items", () => {
    const out = toBullets([para("Number line strips"), para("Number cards")]);
    expect(out.map((b) => b.text)).toEqual(["Number line strips", "Number cards"]);
  });

  it("keeps an NB note separate even when it is indented like a continuation", () => {
    const out = toBullets([bullet("Visiting shops"), indentedPara("NB: only whole number prices")]);
    expect(out.map((b) => b.text)).toEqual(["Visiting shops", "NB: only whole number prices"]);
  });

  it("folds dash sub-lists into their parent bullet", () => {
    const out = toBullets([
      bullet("read data from ready reckoners such as:"),
      dash("Tables"),
      dash("Bar graphs"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe("read data from ready reckoners such as: Tables, Bar graphs");
  });

  it("treats typed dash lines as sub-items and a plain line after them as the wrap of the last one", () => {
    const out = toBullets([
      bullet("Area of:"),
      indentedPara("-rectangle,"),
      indentedPara("-irregular"),
      indentedPara("shapes"),
    ]);
    expect(out[0]!.text).toBe("Area of: rectangle, irregular shapes");
  });

  it("continues a bullet with a following paragraph that contains an equation, even if not indented", () => {
    const out = toBullets([
      bullet("Finding percentages equivalent to:"),
      para("1 2 , 1 4", { hasFormula: true }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("treats a list item WITHOUT a bullet glyph as the second half of a bullet split across a page", () => {
    const out = toBullets([
      bullet("Highest Common Factor (HCF) of two numbers (where the"),
      item({ text: "HCF is less than 20)", label: "", kind: "li", page: 2 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe(
      "Highest Common Factor (HCF) of two numbers (where the HCF is less than 20)",
    );
    expect(out[0]!.pageEnd).toBe(2);
  });

  it("continues a sentence across a page break when the next page starts mid-sentence", () => {
    const first = para(
      "Multiplication of decimal numbers up to 3 decimal places (where the multiplicand is a decimal",
      { page: 1 },
    );
    const tail = para("number of up to 2 decimal places)", { page: 2, afterPageBreak: true });
    expect(toBullets([first, tail])).toHaveLength(1);
  });

  it("starts a NEW item after a page break when the next page starts a fresh sentence", () => {
    const first = para("Number line strips", { page: 1 });
    const tail = para("Number cards", { page: 2, afterPageBreak: true });
    expect(toBullets([first, tail])).toHaveLength(2);
  });

  it("joins a wrapped lower-case line that follows a bulleted item even without indentation", () => {
    const out = toBullets([bullet("Giving values of digits with not more"), para("than 5 digits")]);
    expect(out).toHaveLength(1);
  });

  it("never drops an item: every input item ends up in exactly one bullet", () => {
    const items = [
      bullet("a"),
      indentedPara("b"),
      bullet("c"),
      dash("d"),
      para("NB x"),
      bullet("e"),
    ];
    const out = toBullets(items);
    expect(out.flatMap((b) => b.items)).toHaveLength(items.length);
  });

  it("ignores empty bullets (and can count them so the caller can warn)", () => {
    const items = [bullet("real"), bullet(""), bullet("another")];
    expect(toBullets(items).map((b) => b.text)).toEqual(["real", "another"]);
    expect(countEmptyBullets(items)).toBe(1);
  });

  it("keeps ordering labels like 'iii)' in the verbatim source text but not in the cleaned text", () => {
    const out = toBullets([bullet("1 ordinary year = 365 days", { label: "iii)" })]);
    expect(out[0]!.text).toBe("1 ordinary year = 365 days");
    expect(out[0]!.sourceText).toBe("iii) 1 ordinary year = 365 days");
  });

  it("records the pages a bullet spans", () => {
    const out = toBullets([
      bullet("starts here", { page: 4 }),
      indentedPara("and continues", { page: 5 }),
    ]);
    expect([out[0]!.page, out[0]!.pageEnd]).toEqual([4, 5]);
  });
});

describe("withSubItems / mergeBullets", () => {
  it("renders 'Parent: a, b' without doubling typed commas", () => {
    expect(withSubItems("Area of:", ["rectangle,", "square,", "triangle"])).toBe(
      "Area of: rectangle, square, triangle",
    );
    expect(withSubItems("Rate", ["Distance", "Speed"])).toBe("Rate: Distance, Speed");
    expect(withSubItems("Rate", [])).toBe("Rate");
  });

  it("merges two bullets while keeping both visible in the source text", () => {
    const [a, b] = toBullets([bullet("with not more"), bullet("than 5 digits")]) as [
      ReturnType<typeof toBullets>[number],
      ReturnType<typeof toBullets>[number],
    ];
    const merged = mergeBullets(a, b);
    expect(merged.text).toBe("with not more than 5 digits");
    expect(merged.sourceText).toBe("with not more\n• than 5 digits");
    expect(merged.normalizations).toContain("REVIEWED_JOIN");
  });
});
