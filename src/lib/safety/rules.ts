import { z } from "zod";

/**
 * Reviewing what the safety screen flagged: the words used, the choices on offer and the order the
 * messages are listed in. Pure, so it is tested without a database.
 */

export const OUTCOMES = ["NO_CONCERN", "ACTION_TAKEN"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  NO_CONCERN: "No concern: nothing needs doing",
  ACTION_TAKEN: "Followed up under our safeguarding procedure",
};

export const CATEGORY_LABELS: Record<string, string> = {
  WELLBEING: "Sounded worrying",
  PERSONAL_INFO: "Shared personal details",
};

export const reviewInputSchema = z.object({
  messageId: z.uuid(),
  outcome: z.enum(OUTCOMES, { error: "Choose what you decided." }),
  note: z
    .string()
    .trim()
    .max(1000, "Keep the note under 1 000 characters.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export interface FlaggedItem {
  messageId: string;
  at: string;
  categories: string[];
  /** The child's message as it was kept: personal details already replaced by [removed]. */
  content: string;
  learnerId: string;
  learnerName: string;
  grade: number | null;
  review: { outcome: Outcome; note: string | null; at: string } | null;
}

/** How urgent a flagged message is: a message that sounded worrying outranks one with a phone number. */
const URGENCY = (item: FlaggedItem): number => (item.categories.includes("WELLBEING") ? 0 : 1);

/** Open messages first (the worrying ones before the rest), then newest first. */
export function sortFlagged(items: readonly FlaggedItem[]): FlaggedItem[] {
  return [...items].sort(
    (a, b) =>
      Number(a.review !== null) - Number(b.review !== null) ||
      (a.review === null ? URGENCY(a) - URGENCY(b) : 0) ||
      Date.parse(b.at) - Date.parse(a.at),
  );
}

export interface FlaggedCounts {
  open: number;
  openWorrying: number;
  reviewed: number;
}

export function countFlagged(items: readonly FlaggedItem[]): FlaggedCounts {
  const open = items.filter((i) => i.review === null);
  return {
    open: open.length,
    openWorrying: open.filter((i) => i.categories.includes("WELLBEING")).length,
    reviewed: items.length - open.length,
  };
}
