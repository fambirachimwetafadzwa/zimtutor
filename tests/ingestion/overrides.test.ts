import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOverrides, OverrideIndex, overridesFileSchema } from "../../src/ingestion/overrides";

const fix = {
  page: 41,
  match: "1 2 , 1 4",
  text: "1/2, 1/4",
  reason: "stacked fractions flattened by extraction",
  verified: "compared with the page image at 110 dpi",
};

describe("OverrideIndex", () => {
  it("matches on page and verbatim text, ignoring whitespace differences", () => {
    const index = new OverrideIndex([fix]);
    expect(index.find(41, "1  2 ,\n1 4")?.text).toBe("1/2, 1/4");
    expect(index.find(40, "1 2 , 1 4")).toBeUndefined();
    expect(index.find(41, "something else")).toBeUndefined();
  });

  it("reports corrections that matched nothing, so they cannot rot silently", () => {
    const index = new OverrideIndex([fix]);
    expect(index.unused()).toHaveLength(1);
    index.find(41, "1 2 , 1 4");
    expect(index.unused()).toHaveLength(0);
  });

  it("rejects duplicate entries", () => {
    expect(() => new OverrideIndex([fix, fix])).toThrow(/Duplicate/);
  });

  it("applies a join only when the next bullet really is the recorded second half", () => {
    const join = {
      page: 40,
      first: "with not more",
      second: "than 5 digits",
      reason: "accidental split bullet",
      verified: "compared with the page image",
    };
    const index = new OverrideIndex([], [], [join]);
    expect(index.findJoin(40, "with not more", "something else")).toBeUndefined();
    expect(index.unusedJoins()).toHaveLength(1);
    expect(index.findJoin(40, "with not more", "than 5 digits")).toBeDefined();
    expect(index.unusedJoins()).toHaveLength(0);
  });

  it("tracks errata the same way", () => {
    const erratum = {
      page: 76,
      match: "degrees0",
      issue: "stray character after degrees",
      probable_intent: "degrees (degree sign)",
    };
    const index = new OverrideIndex([], [erratum]);
    expect(index.unusedErrata()).toHaveLength(1);
    expect(index.findErratum(76, "degrees0")).toBeDefined();
    expect(index.unusedErrata()).toHaveLength(0);
  });
});

describe("overrides file", () => {
  it("demands a reason and a human verification note for every correction", () => {
    expect(
      overridesFileSchema.safeParse({ document_id: "d", text_fixes: [{ ...fix, verified: "" }] })
        .success,
    ).toBe(false);
    expect(
      overridesFileSchema.safeParse({ document_id: "d", text_fixes: [{ ...fix, reason: "x" }] })
        .success,
    ).toBe(false);
    expect(overridesFileSchema.safeParse({ document_id: "d", text_fixes: [fix] }).success).toBe(
      true,
    );
  });

  it("treats a missing file as 'no overrides' and refuses unknown fields", () => {
    expect(loadOverrides("/nonexistent/overrides.json").text_fixes).toEqual([]);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zt-")), "o.json");
    fs.writeFileSync(file, JSON.stringify({ document_id: "d", text_fixes: [], surprise: true }));
    expect(() => loadOverrides(file)).toThrow();
  });

  it("the committed overrides file parses and has a reviewer note for every entry", () => {
    const real = loadOverrides("curriculum/overrides/mopse-junior-mathematics-2024-2030.json");
    expect(real.text_fixes.length).toBeGreaterThanOrEqual(11);
    for (const f of real.text_fixes) expect(f.verified.length).toBeGreaterThan(10);
  });
});
