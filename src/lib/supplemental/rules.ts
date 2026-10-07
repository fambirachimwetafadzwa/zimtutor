import { z } from "zod";

/**
 * Labelling rules for supplemental material (spec §20): content is OFFICIAL_CURRICULUM,
 * OFFICIAL_ASSESSMENT, SUPPLEMENTAL, AI_GENERATED or UNVERIFIED, and the categories are NEVER mixed
 * silently. These rules mirror the database CHECK constraints (so the form can explain a refusal
 * before the database enforces it) and add the stricter, human-facing ones:
 *
 *   • OFFICIAL_* needs a source document, a page and the verbatim quote — and the quote must really
 *     appear on that page of the stored document text (checked by `quoteAppearsOnPage`);
 *   • a human can only mark content ADMIN_REVIEWED, never VERIFIED_FROM_SOURCE (reserved for text
 *     the ingestion pipeline extracted);
 *   • content of unknown origin (UNVERIFIED) cannot be called reviewed.
 */

export const SOURCE_TYPES = [
  "OFFICIAL_CURRICULUM",
  "OFFICIAL_ASSESSMENT",
  "SUPPLEMENTAL",
  "AI_GENERATED",
  "UNVERIFIED",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** What a person may set. VERIFIED_FROM_SOURCE is deliberately absent. */
export const REVIEW_STATUSES = ["UNVERIFIED", "ADMIN_REVIEWED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const KINDS = [
  "CONTENT",
  "ACTIVITY",
  "RESOURCE",
  "EXPLANATION",
  "WORKED_EXAMPLE",
  "NOTE",
] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABELS: Record<Kind, string> = {
  CONTENT: "Content",
  ACTIVITY: "Suggested activity",
  RESOURCE: "Suggested resource",
  EXPLANATION: "Explanation",
  WORKED_EXAMPLE: "Worked example",
  NOTE: "Note",
};

export interface SourceTypeInfo {
  label: string;
  description: string;
  /** Visual family, so the five categories are never confused at a glance. */
  tone: "official" | "supplemental" | "ai" | "unverified";
}

export const SOURCE_TYPE_INFO: Record<SourceType, SourceTypeInfo> = {
  OFFICIAL_CURRICULUM: {
    label: "Official curriculum",
    description: "Quoted from the official syllabus; cites the document, page and wording.",
    tone: "official",
  },
  OFFICIAL_ASSESSMENT: {
    label: "Official assessment",
    description: "From an official assessment document; cites the document, page and wording.",
    tone: "official",
  },
  SUPPLEMENTAL: {
    label: "Supplemental",
    description: "Teaching material added by a person to support the syllabus. Not part of it.",
    tone: "supplemental",
  },
  AI_GENERATED: {
    label: "AI-generated",
    description: "Written by an AI model. Never official, whatever its status.",
    tone: "ai",
  },
  UNVERIFIED: {
    label: "Unverified",
    description: "Origin not established. Not shown to learners as curriculum.",
    tone: "unverified",
  },
};

export const STATUS_LABELS: Record<ReviewStatus | "VERIFIED_FROM_SOURCE", string> = {
  UNVERIFIED: "Not reviewed",
  ADMIN_REVIEWED: "Reviewed by an administrator",
  REJECTED: "Rejected",
  VERIFIED_FROM_SOURCE: "Verified from source (pipeline)",
};

export const isOfficial = (type: SourceType) =>
  type === "OFFICIAL_CURRICULUM" || type === "OFFICIAL_ASSESSMENT";

/** Normalise for quote matching: Unicode compatibility, quotes/dashes, whitespace and case. */
export function normaliseForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[•·●⚫▪◦]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Does `quote` literally occur in `pageText` (ignoring case, spacing, bullets and dash styles)? */
export function quoteAppearsOnPage(pageText: string, quote: string): boolean {
  const needle = normaliseForMatch(quote);
  return needle.length > 0 && normaliseForMatch(pageText).includes(needle);
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const labelFields = {
  sourceType: z.enum(SOURCE_TYPES),
  verificationStatus: z.enum(REVIEW_STATUSES),
  sourceDocumentId: z.preprocess(emptyToUndefined, z.string().max(80).optional()),
  sourcePage: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(10000).optional()),
  sourceText: z.preprocess(emptyToUndefined, z.string().trim().max(4000).optional()),
};

/** The rules that relate a label to its status and citation. Reported per field so a form can show them. */
function checkLabel(
  v: {
    sourceType: SourceType;
    verificationStatus: ReviewStatus;
    sourceDocumentId?: string;
    sourcePage?: number;
    sourceText?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (isOfficial(v.sourceType)) {
    if (!v.sourceDocumentId)
      ctx.addIssue({
        code: "custom",
        path: ["sourceDocumentId"],
        message: "Official content must cite its source document.",
      });
    if (!v.sourcePage)
      ctx.addIssue({
        code: "custom",
        path: ["sourcePage"],
        message: "Official content must cite the page it comes from.",
      });
    if (!v.sourceText)
      ctx.addIssue({
        code: "custom",
        path: ["sourceText"],
        message: "Official content must include the exact wording from that page.",
      });
    if (v.verificationStatus !== "ADMIN_REVIEWED") {
      ctx.addIssue({
        code: "custom",
        path: ["verificationStatus"],
        message: "Official labels require the content to be reviewed by an administrator.",
      });
    }
  }
  if (v.sourceType === "UNVERIFIED" && v.verificationStatus === "ADMIN_REVIEWED") {
    ctx.addIssue({
      code: "custom",
      path: ["verificationStatus"],
      message:
        "Content of unknown origin cannot be marked as reviewed. Choose Supplemental or AI-generated once you know where it came from.",
    });
  }
}

export const supplementalInputSchema = z
  .object({
    objectiveId: z.string().trim().min(1),
    kind: z.enum(KINDS),
    title: z.preprocess(emptyToUndefined, z.string().trim().max(120).optional()),
    body: z
      .string()
      .trim()
      .min(1, "Please write the content.")
      .max(8000, "Please keep it under 8,000 characters."),
    ...labelFields,
  })
  .superRefine(checkLabel);
export type SupplementalInput = z.infer<typeof supplementalInputSchema>;

export const relabelInputSchema = z
  .object({
    id: z.uuid(),
    ...labelFields,
    reason: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  })
  .superRefine(checkLabel);
export type RelabelInput = z.infer<typeof relabelInputSchema>;
