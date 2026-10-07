import { describe, expect, it } from "vitest";
import {
  assembleRows,
  COL,
  maxNumber,
  parseMatrixHeading,
  type Fragment,
} from "../../src/ingestion/matrix";
import type { Item } from "../../src/ingestion/tables";
import { bullet, para } from "./helpers";

describe("parseMatrixHeading", () => {
  it("parses the printed variants of the matrix headings", () => {
    expect(parseMatrixHeading("8.1 (GRADE 3) TOPIC 1: NUMBER (0 to 1 000)")).toMatchObject({
      sectionNumber: "8.1",
      grade: 3,
      topic: "NUM",
      scopeText: "0 to 1 000",
      scopeMax: 1000,
    });
    expect(parseMatrixHeading("8.8 (GRADE 4) TOPIC: RELATIONSHIPS")).toMatchObject({
      grade: 4,
      topic: "REL",
      scopeText: null,
    });
    expect(parseMatrixHeading("8.13 (GRADE 6) TOPIC: NUMBER (0–1 000 000)")).toMatchObject({
      topic: "NUM",
      scopeMax: 1_000_000,
    });
    expect(parseMatrixHeading("8.14 (GRADE 6) TOPIC 2: OPERATIONS (0 – 1 000 000)")).toMatchObject({
      topic: "OPS",
      scopeMax: 1_000_000,
    });
    expect(parseMatrixHeading("8.11 (GRADE 5) TOPIC 3: MEASURES")).toMatchObject({ topic: "MEA" });
  });

  it("ignores headings that are not matrix headings", () => {
    expect(parseMatrixHeading("7.1 TOPIC 1: NUMBER")).toBeNull();
    expect(parseMatrixHeading("9 ASSESSMENT")).toBeNull();
  });

  it("refuses a matrix heading for a topic the syllabus does not have", () => {
    expect(() => parseMatrixHeading("8.2 (GRADE 3) TOPIC 5: ALGEBRA")).toThrow(/unknown topic/);
  });
});

describe("maxNumber", () => {
  it("reads thousands-separated numbers", () => {
    expect(maxNumber("0 to 10 000 000")).toBe(10_000_000);
    expect(maxNumber("0–1 000")).toBe(1000);
    expect(maxNumber("none")).toBeNull();
  });
});

/** A fragment with objective/name text placed on a given start page. */
function fragment(
  index: number,
  page: number,
  cols: Partial<Record<keyof typeof COL, Item[]>>,
  endPage = page,
): Fragment {
  const all = (name: keyof typeof COL) => cols[name] ?? [];
  return {
    index,
    startPage: page,
    endPage,
    cols: [all("SUBTOPIC"), all("OBJECTIVES"), all("CONTENT"), all("ACTIVITIES"), all("RESOURCES")],
  };
}

describe("assembleRows", () => {
  it("starts the first sub-topic from the first fragment", () => {
    const rows = assembleRows(
      [fragment(0, 5, { SUBTOPIC: [para("Money")], OBJECTIVES: [bullet("identify currency")] })],
      "t",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startsSubtopic).toBe(true);
  });

  it("fails loudly if the table starts without a sub-topic name", () => {
    expect(() =>
      assembleRows([fragment(0, 5, { OBJECTIVES: [bullet("x")] })], "Grade 3 Number"),
    ).toThrow(/first row has no sub-topic text/);
  });

  it("starts a new sub-topic when the first column has text", () => {
    const rows = assembleRows(
      [
        fragment(0, 5, { SUBTOPIC: [para("Money")], OBJECTIVES: [bullet("a")] }),
        fragment(1, 5, { SUBTOPIC: [para("Time")], OBJECTIVES: [bullet("b")] }),
      ],
      "t",
    );
    expect(rows.map((r) => r.startsSubtopic)).toEqual([true, true]);
  });

  it("treats a row with an empty first cell but its own objectives as another row of the SAME sub-topic", () => {
    const rows = assembleRows(
      [
        fragment(0, 5, { SUBTOPIC: [para("Time")], OBJECTIVES: [bullet("tell time")] }),
        fragment(1, 5, { OBJECTIVES: [bullet("identify days")] }),
      ],
      "t",
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]!.startsSubtopic).toBe(false);
    expect(rows[1]!.assembly[0]).toMatch(/^sub-row/);
  });

  it("merges a page-top fragment with NO objectives into the previous row (spill-over tail)", () => {
    const rows = assembleRows(
      [
        fragment(0, 5, {
          SUBTOPIC: [para("Money")],
          OBJECTIVES: [bullet("a")],
          RESOURCES: [bullet("Number lines")],
        }),
        fragment(1, 6, { RESOURCES: [bullet("Number strips")] }),
      ],
      "t",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cols[COL.RESOURCES]!.map((i) => i.text)).toEqual([
      "Number lines",
      "Number strips",
    ]);
    expect(rows[0]!.assembly).toContain("tail:p6");
  });

  it("does NOT treat a fragment WITH objectives at the top of a page as a tail (it is a new row)", () => {
    const rows = assembleRows(
      [
        fragment(0, 5, { SUBTOPIC: [para("Whole numbers")], OBJECTIVES: [bullet("a")] }),
        fragment(1, 6, { OBJECTIVES: [bullet("round off numbers")] }),
      ],
      "t",
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]!.startsSubtopic).toBe(false);
  });

  it("recognises a page-top fragment whose first column is the wrapped rest of the previous name (even with objectives)", () => {
    const rows = assembleRows(
      [
        fragment(0, 5, {
          SUBTOPIC: [para("Multiplication of whole numbers")],
          OBJECTIVES: [bullet("illustrate multiplication")],
        }),
        fragment(1, 6, {
          SUBTOPIC: [para("(whose product is less than 100 000)")],
          OBJECTIVES: [bullet("multiply by three-digit numbers")],
        }),
      ],
      "t",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cols[COL.OBJECTIVES]!).toHaveLength(2);
    expect(rows[0]!.assembly).toContain("tail:p6+name+objectives");
  });

  it("starts a NEW sub-topic at the top of a page when the first column holds a genuinely new name", () => {
    const rows = assembleRows(
      [
        fragment(0, 5, { SUBTOPIC: [para("Mass")], OBJECTIVES: [bullet("a")] }),
        fragment(1, 6, { SUBTOPIC: [para("Length")], OBJECTIVES: [bullet("b")] }),
      ],
      "t",
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]!.startsSubtopic).toBe(true);
  });

  it("marks the first item of each column in a tail so a mid-sentence start can be recognised", () => {
    const rows = assembleRows(
      [
        fragment(0, 5, {
          SUBTOPIC: [para("Rate")],
          OBJECTIVES: [bullet("a")],
          ACTIVITIES: [bullet("Linking")],
        }),
        fragment(1, 6, { ACTIVITIES: [para("two measures")] }),
      ],
      "t",
    );
    expect(rows[0]!.cols[COL.ACTIVITIES]![1]!.afterPageBreak).toBe(true);
  });
});
