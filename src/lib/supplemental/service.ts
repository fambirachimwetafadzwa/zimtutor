import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  quoteAppearsOnPage,
  isOfficial,
  type RelabelInput,
  type SourceType,
  type SupplementalInput,
} from "./rules";

/**
 * Creating, relabelling and listing supplemental material.
 *
 * Writes use the SERVICE-ROLE client (clients have no write privileges on these tables) and are
 * therefore only ever called after the acting administrator has been authenticated; `adminId`
 * always comes from the verified session, never from a form. Every change is recorded in
 * admin_audit_log with the state before and after.
 */

export type ServiceResult =
  { ok: true; id: string } | { ok: false; fieldErrors?: Record<string, string>; error?: string };

const fail = (fieldErrors: Record<string, string>): ServiceResult => ({ ok: false, fieldErrors });

/**
 * An OFFICIAL_* label is only believable if the quotation really is in the cited document: check it
 * against the page text the ingestion pipeline stored. Documents without stored page text cannot
 * carry an official label at all.
 */
export async function verifyCitation(
  service: SupabaseClient,
  citation: { documentId: string; page: number; quote: string },
): Promise<{ ok: true } | { ok: false; fieldErrors: Record<string, string> }> {
  const { data: document } = await service
    .from("curriculum_documents")
    .select("id, title, page_count")
    .eq("id", citation.documentId)
    .maybeSingle();
  if (!document)
    return {
      ok: false,
      fieldErrors: {
        sourceDocumentId:
          "That document is not one ZimTutor has ingested, so it cannot be cited as official.",
      },
    };
  if (citation.page > (document.page_count as number)) {
    return {
      ok: false,
      fieldErrors: { sourcePage: `${document.title} has only ${document.page_count} pages.` },
    };
  }
  const { data: page } = await service
    .from("curriculum_document_pages")
    .select("text")
    .eq("document_id", citation.documentId)
    .eq("page", citation.page)
    .maybeSingle();
  if (!page)
    return {
      ok: false,
      fieldErrors: {
        sourcePage: "The text of that page is not stored, so the wording cannot be checked.",
      },
    };
  if (!quoteAppearsOnPage(String(page.text), citation.quote)) {
    return {
      ok: false,
      fieldErrors: {
        sourceText: `That wording does not appear on page ${citation.page} of ${document.title}. Copy it exactly as printed, or use the Supplemental label.`,
      },
    };
  }
  return { ok: true };
}

async function audit(
  service: SupabaseClient,
  adminId: string,
  entry: { action: string; entityId: string; before: unknown; after: unknown },
) {
  const { error } = await service.from("admin_audit_log").insert({
    admin_id: adminId,
    action: entry.action,
    entity_type: "supplemental_content",
    entity_id: entry.entityId,
    before_state: entry.before,
    after_state: entry.after,
  });
  if (error) throw new Error(`Could not write the audit log: ${error.message}`);
}

export async function createSupplemental(
  service: SupabaseClient,
  adminId: string,
  input: SupplementalInput,
): Promise<ServiceResult> {
  const { data: objective } = await service
    .from("learning_objectives")
    .select("id, subtopic_id, retired_at")
    .eq("id", input.objectiveId)
    .maybeSingle();
  if (!objective || objective.retired_at)
    return {
      ok: false,
      error: "That learning objective does not exist (or is no longer part of the curriculum).",
    };

  if (isOfficial(input.sourceType)) {
    const verdict = await verifyCitation(service, {
      documentId: input.sourceDocumentId!,
      page: input.sourcePage!,
      quote: input.sourceText!,
    });
    if (!verdict.ok) return fail(verdict.fieldErrors);
  }

  const row = {
    objective_id: input.objectiveId,
    subtopic_id: objective.subtopic_id,
    kind: input.kind,
    title: input.title ?? null,
    body: input.body,
    source_type: input.sourceType,
    verification_status: input.verificationStatus,
    source_document_id: input.sourceDocumentId ?? null,
    source_page: input.sourcePage ?? null,
    source_text: input.sourceText ?? null,
    created_by: adminId,
    reviewed_by: input.verificationStatus === "ADMIN_REVIEWED" ? adminId : null,
  };
  const { data, error } = await service
    .from("supplemental_content")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "We couldn't save that. Please try again." };
  await audit(service, adminId, {
    action: "SUPPLEMENTAL_CREATED",
    entityId: data.id as string,
    before: null,
    after: row,
  });
  return { ok: true, id: data.id as string };
}

export async function relabelSupplemental(
  service: SupabaseClient,
  adminId: string,
  input: RelabelInput,
): Promise<ServiceResult> {
  const { data: before } = await service
    .from("supplemental_content")
    .select(
      "id, source_type, verification_status, source_document_id, source_page, source_text, reviewed_by",
    )
    .eq("id", input.id)
    .maybeSingle();
  if (!before) return { ok: false, error: "That item no longer exists." };

  if (isOfficial(input.sourceType)) {
    const verdict = await verifyCitation(service, {
      documentId: input.sourceDocumentId!,
      page: input.sourcePage!,
      quote: input.sourceText!,
    });
    if (!verdict.ok) return fail(verdict.fieldErrors);
  }

  const after = {
    source_type: input.sourceType as SourceType,
    verification_status: input.verificationStatus,
    // A citation only means something on an official label: clear it otherwise.
    source_document_id: isOfficial(input.sourceType) ? (input.sourceDocumentId ?? null) : null,
    source_page: isOfficial(input.sourceType) ? (input.sourcePage ?? null) : null,
    source_text: isOfficial(input.sourceType) ? (input.sourceText ?? null) : null,
    reviewed_by: input.verificationStatus === "ADMIN_REVIEWED" ? adminId : null,
  };
  const { error } = await service.from("supplemental_content").update(after).eq("id", input.id);
  if (error) return { ok: false, error: "We couldn't change that label. Please try again." };
  await audit(service, adminId, {
    action: "SUPPLEMENTAL_RELABELLED",
    entityId: input.id,
    before,
    after: { ...after, reason: input.reason ?? null },
  });
  return { ok: true, id: input.id };
}

const itemSchema = z.object({
  id: z.string(),
  objective_id: z.string().nullable(),
  kind: z.string(),
  title: z.string().nullable(),
  body: z.string(),
  source_type: z.string(),
  verification_status: z.string(),
  source_document_id: z.string().nullable(),
  source_page: z.number().nullable(),
  source_text: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SupplementalItem = z.infer<typeof itemSchema>;

export interface SupplementalFilter {
  objectiveId?: string;
  sourceType?: string;
  verificationStatus?: string;
  limit?: number;
}

/** Read with the ADMIN'S OWN client: row-level security restricts these tables to administrators. */
export async function listSupplemental(
  db: SupabaseClient,
  filter: SupplementalFilter = {},
): Promise<SupplementalItem[]> {
  let query = db
    .from("supplemental_content")
    .select(
      "id, objective_id, kind, title, body, source_type, verification_status, source_document_id, source_page, source_text, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 200);
  if (filter.objectiveId) query = query.eq("objective_id", filter.objectiveId);
  if (filter.sourceType) query = query.eq("source_type", filter.sourceType);
  if (filter.verificationStatus) query = query.eq("verification_status", filter.verificationStatus);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load supplemental content: ${error.message}`);
  return z.array(itemSchema).parse(data);
}

export interface LabelCounts {
  bySourceType: Record<string, number>;
  byStatus: Record<string, number>;
  total: number;
}

export async function countSupplementalByLabel(db: SupabaseClient): Promise<LabelCounts> {
  const { data, error } = await db
    .from("supplemental_content")
    .select("source_type, verification_status")
    .limit(5000);
  if (error) throw new Error(`Could not count supplemental content: ${error.message}`);
  const counts: LabelCounts = { bySourceType: {}, byStatus: {}, total: data.length };
  for (const row of data) {
    counts.bySourceType[row.source_type as string] =
      (counts.bySourceType[row.source_type as string] ?? 0) + 1;
    counts.byStatus[row.verification_status as string] =
      (counts.byStatus[row.verification_status as string] ?? 0) + 1;
  }
  return counts;
}

export interface AuditEntry {
  id: number;
  admin_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_state: unknown;
  after_state: unknown;
  created_at: string;
}

export async function listAuditLog(db: SupabaseClient, limit = 100): Promise<AuditEntry[]> {
  const { data, error } = await db
    .from("admin_audit_log")
    .select("id, admin_id, action, entity_type, entity_id, before_state, after_state, created_at")
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load the audit log: ${error.message}`);
  return data as AuditEntry[];
}
