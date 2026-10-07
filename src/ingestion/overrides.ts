import fs from "node:fs";
import { z } from "zod";

/**
 * Reviewed corrections.
 *
 * A few items in the syllabus use Word equations (stacked fractions, powers, ½ × base × height)
 * that PDF text extraction flattens into misleading text — for example the printed "365¼ days" comes
 * out as "3651 days". Every such item MUST have an entry here, made by a person who compared it with
 * the page image. The pipeline refuses to run if a flagged item has no reviewed entry, and refuses
 * stale entries that no longer match anything, so a correction can neither be forgotten nor rot.
 *
 * An override changes only the cleaned `text`; the verbatim `source_text` is never altered.
 */

const overrideSchema = z
  .object({
    /** PDF page where the bullet starts. */
    page: z.number().int().positive(),
    /** The bullet's verbatim extracted text (exactly as in `source_text`, without newlines). */
    match: z.string().min(1),
    /** The correct text, as printed on the page. */
    text: z.string().min(1),
    reason: z.string().min(10),
    /** How a person confirmed it ("compared with page image at 110dpi"). */
    verified: z.string().min(10),
  })
  .strict();

/**
 * Two consecutive bullets that the source accidentally split in the middle of one sentence
 * (a stray Enter key in the Ministry's file). The join is explicit and reviewed; both original
 * bullets stay visible in the merged record's source_text.
 */
const joinSchema = z
  .object({
    page: z.number().int().positive(),
    /** Verbatim text of the first bullet, and of the bullet that directly follows it. */
    first: z.string().min(1),
    second: z.string().min(1),
    reason: z.string().min(10),
    verified: z.string().min(10),
  })
  .strict();

/**
 * A suspected error in the OFFICIAL document (a typo, a repeated variable). We never edit official
 * wording; the erratum is surfaced to admins as a warning so the issue can be raised with the
 * Ministry, and tutors can be guided around it.
 */
const erratumSchema = z
  .object({
    page: z.number().int().positive(),
    /** Verbatim extracted bullet text the erratum refers to. */
    match: z.string().min(1),
    issue: z.string().min(10),
    probable_intent: z.string().min(1),
  })
  .strict();

export const overridesFileSchema = z
  .object({
    document_id: z.string(),
    text_fixes: z.array(overrideSchema),
    joins: z.array(joinSchema).default([]),
    errata: z.array(erratumSchema).default([]),
  })
  .strict();

export type TextFix = z.infer<typeof overrideSchema>;
export type Erratum = z.infer<typeof erratumSchema>;
export type BulletJoin = z.infer<typeof joinSchema>;
export type OverridesFile = z.infer<typeof overridesFileSchema>;

export function loadOverrides(filePath: string): OverridesFile {
  if (!fs.existsSync(filePath)) return { document_id: "", text_fixes: [], joins: [], errata: [] };
  return overridesFileSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

/** Matches overrides and errata to extracted bullets and remembers which were used. */
export class OverrideIndex {
  private readonly byKey = new Map<string, TextFix>();
  private readonly used = new Set<string>();
  private readonly errataByKey = new Map<string, Erratum>();
  private readonly errataUsed = new Set<string>();

  private readonly joinsByKey = new Map<string, BulletJoin>();
  private readonly joinsUsed = new Set<string>();

  constructor(fixes: TextFix[], errata: Erratum[] = [], joins: BulletJoin[] = []) {
    for (const join of joins) {
      const key = OverrideIndex.key(join.page, join.first);
      if (this.joinsByKey.has(key))
        throw new Error(`Duplicate join for page ${join.page}: ${JSON.stringify(join.first)}`);
      this.joinsByKey.set(key, join);
    }
    for (const fix of fixes) {
      const key = OverrideIndex.key(fix.page, fix.match);
      if (this.byKey.has(key))
        throw new Error(`Duplicate text fix for page ${fix.page}: ${JSON.stringify(fix.match)}`);
      this.byKey.set(key, fix);
    }
    for (const erratum of errata) {
      const key = OverrideIndex.key(erratum.page, erratum.match);
      if (this.errataByKey.has(key))
        throw new Error(
          `Duplicate erratum for page ${erratum.page}: ${JSON.stringify(erratum.match)}`,
        );
      this.errataByKey.set(key, erratum);
    }
  }

  /** The reviewed join that starts with this bullet, if its `second` text matches the next bullet. */
  findJoin(page: number, firstText: string, nextText: string | undefined): BulletJoin | undefined {
    const key = OverrideIndex.key(page, firstText);
    const join = this.joinsByKey.get(key);
    if (!join || nextText === undefined) return undefined;
    if (join.second.replace(/\s+/g, " ").trim() !== nextText.replace(/\s+/g, " ").trim())
      return undefined;
    this.joinsUsed.add(key);
    return join;
  }

  unusedJoins(): BulletJoin[] {
    return [...this.joinsByKey.entries()]
      .filter(([key]) => !this.joinsUsed.has(key))
      .map(([, j]) => j);
  }

  findErratum(page: number, sourceText: string): Erratum | undefined {
    const key = OverrideIndex.key(page, sourceText);
    const erratum = this.errataByKey.get(key);
    if (erratum) this.errataUsed.add(key);
    return erratum;
  }

  unusedErrata(): Erratum[] {
    return [...this.errataByKey.entries()]
      .filter(([key]) => !this.errataUsed.has(key))
      .map(([, e]) => e);
  }

  private static key(page: number, match: string): string {
    return `${page}\u0000${match.replace(/\s+/g, " ").trim()}`;
  }

  find(page: number, sourceText: string): TextFix | undefined {
    const key = OverrideIndex.key(page, sourceText);
    const fix = this.byKey.get(key);
    if (fix) this.used.add(key);
    return fix;
  }

  unused(): TextFix[] {
    return [...this.byKey.entries()].filter(([key]) => !this.used.has(key)).map(([, fix]) => fix);
  }
}
