import { describe, expect, it } from "vitest";
import {
  isOfficial,
  normaliseForMatch,
  quoteAppearsOnPage,
  relabelInputSchema,
  SOURCE_TYPES,
  SOURCE_TYPE_INFO,
  supplementalInputSchema,
} from "../../src/lib/supplemental/rules";

const base = {
  objectiveId: "G5-NUM-PROPER-FRACTIONS-004",
  kind: "NOTE",
  body: "Use fraction strips to compare 1/2 and 3/4.",
  sourceType: "SUPPLEMENTAL",
  verificationStatus: "UNVERIFIED",
};

const errorsOf = (input: unknown) => {
  const result = supplementalInputSchema.safeParse(input);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe("supplemental content labelling rules", () => {
  it("has a description for every one of the five categories, never mixing their tones", () => {
    expect(SOURCE_TYPES).toHaveLength(5);
    for (const type of SOURCE_TYPES)
      expect(SOURCE_TYPE_INFO[type].description.length).toBeGreaterThan(10);
    expect(SOURCE_TYPE_INFO.AI_GENERATED.tone).toBe("ai");
    expect(SOURCE_TYPE_INFO.OFFICIAL_CURRICULUM.tone).toBe(
      SOURCE_TYPE_INFO.OFFICIAL_ASSESSMENT.tone,
    );
    expect(isOfficial("SUPPLEMENTAL")).toBe(false);
  });

  it("accepts ordinary supplemental material without a citation", () => {
    expect(supplementalInputSchema.safeParse(base).success).toBe(true);
    expect(
      supplementalInputSchema.safeParse({
        ...base,
        sourceType: "AI_GENERATED",
        verificationStatus: "ADMIN_REVIEWED",
      }).success,
    ).toBe(true);
  });

  it("requires a document, page and quotation for anything labelled official", () => {
    const errors = errorsOf({
      ...base,
      sourceType: "OFFICIAL_CURRICULUM",
      verificationStatus: "ADMIN_REVIEWED",
    });
    expect(Object.keys(errors).sort()).toEqual(["sourceDocumentId", "sourcePage", "sourceText"]);
    expect(
      supplementalInputSchema.safeParse({
        ...base,
        sourceType: "OFFICIAL_CURRICULUM",
        verificationStatus: "ADMIN_REVIEWED",
        sourceDocumentId: "mopse-junior-mathematics-2024-2030",
        sourcePage: "37",
        sourceText: "compare fractions",
      }).success,
    ).toBe(true);
  });

  it("requires an official label to be reviewed by an administrator", () => {
    const errors = errorsOf({
      ...base,
      sourceType: "OFFICIAL_ASSESSMENT",
      verificationStatus: "UNVERIFIED",
      sourceDocumentId: "d",
      sourcePage: 80,
      sourceText: "quote",
    });
    expect(errors.verificationStatus).toMatch(/reviewed by an administrator/);
  });

  it("does not let content of unknown origin be called reviewed", () => {
    expect(
      errorsOf({ ...base, sourceType: "UNVERIFIED", verificationStatus: "ADMIN_REVIEWED" })
        .verificationStatus,
    ).toMatch(/unknown origin/);
  });

  it("cannot be used to mark anything VERIFIED_FROM_SOURCE (reserved for the pipeline)", () => {
    expect(
      errorsOf({ ...base, verificationStatus: "VERIFIED_FROM_SOURCE" }).verificationStatus,
    ).toBeDefined();
  });

  it("validates the content itself", () => {
    expect(errorsOf({ ...base, body: "   " }).body).toMatch(/write the content/);
    expect(errorsOf({ ...base, body: "x".repeat(8001) }).body).toMatch(/8,000/);
    expect(errorsOf({ ...base, kind: "OTHER" }).kind).toBeDefined();
    expect(errorsOf({ ...base, sourceType: "OFFICIAL_MAGIC" }).sourceType).toBeDefined();
  });

  it("applies the same label rules when relabelling", () => {
    const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(
      relabelInputSchema.safeParse({
        id,
        sourceType: "AI_GENERATED",
        verificationStatus: "REJECTED",
        reason: "wrong grade",
      }).success,
    ).toBe(true);
    expect(
      relabelInputSchema.safeParse({
        id,
        sourceType: "OFFICIAL_CURRICULUM",
        verificationStatus: "ADMIN_REVIEWED",
      }).success,
    ).toBe(false);
    expect(
      relabelInputSchema.safeParse({
        id: "not-a-uuid",
        sourceType: "SUPPLEMENTAL",
        verificationStatus: "UNVERIFIED",
      }).success,
    ).toBe(false);
  });
});

describe("quoteAppearsOnPage", () => {
  const page =
    "•\nCompare fractions\n•\nreduce fractions to their lowest terms – with unlike denominators\n⚫ Use of “fraction strips”";

  it("finds a quotation regardless of case, spacing, bullets and quote/dash styles", () => {
    expect(quoteAppearsOnPage(page, "compare   FRACTIONS")).toBe(true);
    expect(quoteAppearsOnPage(page, "lowest terms - with unlike denominators")).toBe(true);
    expect(quoteAppearsOnPage(page, 'Use of "fraction strips"')).toBe(true);
  });

  it("rejects wording that is not on the page, and empty quotations", () => {
    expect(quoteAppearsOnPage(page, "multiply fractions")).toBe(false);
    expect(quoteAppearsOnPage(page, "   ")).toBe(false);
  });

  it("normalises compatibility characters", () => {
    expect(normaliseForMatch("ﬁnd the ½")).toBe("find the 1⁄2");
  });
});
