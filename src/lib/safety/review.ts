import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  OUTCOMES,
  countFlagged,
  sortFlagged,
  type FlaggedCounts,
  type FlaggedItem,
  type Outcome,
} from "./rules";

/**
 * Listing and reviewing flagged messages.
 *
 * LISTING uses the administrator's OWN session: row-level security lets an administrator read a
 * message only when the safety screen flagged it (every other message of a conversation stays
 * private to the child). WRITING uses the service-role client after the administrator has been
 * verified, and every review is written to the audit log -- WITHOUT the message text, which the audit
 * log would otherwise show to every administrator.
 */

const messageRow = z.object({
  id: z.string(),
  learner_id: z.string(),
  content: z.string(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

const reviewRow = z.object({
  message_id: z.string(),
  outcome: z.enum(OUTCOMES),
  note: z.string().nullable(),
  reviewed_at: z.string(),
});

export async function listFlagged(db: SupabaseClient, limit = 200): Promise<FlaggedItem[]> {
  const { data: messages, error } = await db
    .from("tutor_messages")
    .select("id, learner_id, content, meta, created_at")
    .eq("flagged", true)
    .eq("role", "learner")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not read the flagged messages: ${error.message}`);
  const rows = (messages ?? []).map((m) => messageRow.parse(m));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const learners = [...new Set(rows.map((r) => r.learner_id))];
  const [reviews, names, grades] = await Promise.all([
    db
      .from("safety_reviews")
      .select("message_id, outcome, note, reviewed_at")
      .in("message_id", ids),
    db.from("profiles").select("id, display_name").in("id", learners),
    db.from("learner_profiles").select("profile_id, grade").in("profile_id", learners),
  ]);
  for (const result of [reviews, names, grades])
    if (result.error)
      throw new Error(`Could not read the flagged messages: ${result.error.message}`);

  const reviewByMessage = new Map(
    (reviews.data ?? []).map((r) => {
      const row = reviewRow.parse(r);
      return [row.message_id, row] as const;
    }),
  );
  const nameById = new Map(
    (names.data ?? []).map((n) => [n.id as string, n.display_name as string]),
  );
  const gradeById = new Map(
    (grades.data ?? []).map((g) => [g.profile_id as string, g.grade as number]),
  );

  return sortFlagged(
    rows.map((m): FlaggedItem => {
      const review = reviewByMessage.get(m.id);
      const screen = m.meta?.screen;
      return {
        messageId: m.id,
        at: m.created_at,
        categories: Array.isArray(screen)
          ? screen.filter((c): c is string => typeof c === "string")
          : [],
        content: m.content,
        learnerId: m.learner_id,
        learnerName: nameById.get(m.learner_id) ?? "A learner",
        grade: gradeById.get(m.learner_id) ?? null,
        review: review
          ? { outcome: review.outcome, note: review.note, at: review.reviewed_at }
          : null,
      };
    }),
  );
}

export async function countOpenFlagged(db: SupabaseClient): Promise<FlaggedCounts> {
  return countFlagged(await listFlagged(db));
}

export type ReviewResult = { ok: true } | { ok: false; error: string };

/** Record an administrator's decision about one flagged message. */
export async function reviewFlagged(
  service: SupabaseClient,
  adminId: string,
  input: { messageId: string; outcome: Outcome; note?: string | undefined },
): Promise<ReviewResult> {
  const { data: message } = await service
    .from("tutor_messages")
    .select("id, flagged")
    .eq("id", input.messageId)
    .maybeSingle();
  if (!message || !message.flagged)
    return { ok: false, error: "That message is not one the safety screen flagged." };

  const { data: before } = await service
    .from("safety_reviews")
    .select("outcome, note")
    .eq("message_id", input.messageId)
    .maybeSingle();

  const { error } = await service.from("safety_reviews").upsert({
    message_id: input.messageId,
    reviewed_by: adminId,
    outcome: input.outcome,
    note: input.note ?? null,
    reviewed_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "We couldn't save that. Please try again." };

  const { error: auditError } = await service.from("admin_audit_log").insert({
    admin_id: adminId,
    action: before ? "SAFETY_RE_REVIEWED" : "SAFETY_REVIEWED",
    entity_type: "tutor_message",
    entity_id: input.messageId,
    before_state: before ?? null,
    after_state: { outcome: input.outcome, note: input.note ?? null },
  });
  if (auditError) throw new Error(`Could not write the audit log: ${auditError.message}`);
  return { ok: true };
}
