import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  countSupplementalByLabel,
  createSupplemental,
  listAuditLog,
  listSupplemental,
  relabelSupplemental,
  verifyCitation,
} from "../../src/lib/supplemental/service";
import { relabelInputSchema, supplementalInputSchema } from "../../src/lib/supplemental/rules";

/** Supplemental-content labelling through the real API: rules, citation checks, audit log, access. */

const URL = process.env.INTEGRATION_SUPABASE_URL;
const ANON = process.env.INTEGRATION_SUPABASE_ANON_KEY;
const SERVICE = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(URL && ANON && SERVICE);

const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;
const PASSWORD = "correct horse battery staple";
const DOCUMENT = "mopse-junior-mathematics-2024-2030";
const OBJECTIVE = "G5-NUM-PROPER-FRACTIONS-004";

describe.skipIf(!configured)("supplemental content labelling (real API)", () => {
  let service: SupabaseClient;
  let admin: { id: string; db: SupabaseClient };
  let parent: SupabaseClient;
  let pageWithObjective: number;

  const parse = (input: Record<string, unknown>) =>
    supplementalInputSchema.parse({
      objectiveId: OBJECTIVE,
      kind: "NOTE",
      body: "A note.",
      sourceType: "SUPPLEMENTAL",
      verificationStatus: "UNVERIFIED",
      ...input,
    });

  async function signUp(label: string) {
    const db = createClient(URL!, ANON!, options);
    const { data, error } = await db.auth.signUp({
      email: `${label}-${Date.now().toString(36)}@example.test`,
      password: PASSWORD,
    });
    if (error || !data.user) throw error ?? new Error("sign-up failed");
    return { id: data.user.id, db };
  }

  beforeAll(async () => {
    service = createClient(URL!, SERVICE!, options);
    admin = await signUp("labeller");
    await service.from("profiles").update({ role: "admin" }).eq("id", admin.id);
    parent = (await signUp("someparent")).db;
    const { data } = await service
      .from("learning_objectives")
      .select("source_page")
      .eq("id", OBJECTIVE)
      .single();
    pageWithObjective = data!.source_page as number;
  }, 60_000);

  it("saves supplemental material, labelled and attributed, and records it in the audit log", async () => {
    const result = await createSupplemental(
      service,
      admin.id,
      parse({ title: "Fraction strips", body: "Fold paper strips to compare 1/2 and 3/4." }),
    );
    expect(result.ok).toBe(true);
    const id = (result as { id: string }).id;

    const [item] = await listSupplemental(admin.db, { objectiveId: OBJECTIVE });
    expect(item).toMatchObject({
      id,
      source_type: "SUPPLEMENTAL",
      verification_status: "UNVERIFIED",
      title: "Fraction strips",
    });

    const row = await service
      .from("supplemental_content")
      .select("created_by, reviewed_by, subtopic_id")
      .eq("id", id)
      .single();
    expect(row.data).toMatchObject({
      created_by: admin.id,
      reviewed_by: null,
      subtopic_id: "G5-NUM-PROPER-FRACTIONS",
    });

    const log = await listAuditLog(admin.db, 20);
    const entry = log.find((e) => e.entity_id === id)!;
    expect(entry).toMatchObject({
      action: "SUPPLEMENTAL_CREATED",
      admin_id: admin.id,
      entity_type: "supplemental_content",
      before_state: null,
    });
  });

  it("refuses an OFFICIAL label whose wording is not on the cited page", async () => {
    const result = await createSupplemental(
      service,
      admin.id,
      parse({
        sourceType: "OFFICIAL_CURRICULUM",
        verificationStatus: "ADMIN_REVIEWED",
        sourceDocumentId: DOCUMENT,
        sourcePage: pageWithObjective,
        sourceText: "multiply fractions by integers up to one million",
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { sourceText: expect.stringContaining("does not appear on page") },
    });
  });

  it("accepts an OFFICIAL label when the wording is on the cited page, and records who reviewed it", async () => {
    const result = await createSupplemental(
      service,
      admin.id,
      parse({
        kind: "CONTENT",
        body: "Compare fractions.",
        sourceType: "OFFICIAL_CURRICULUM",
        verificationStatus: "ADMIN_REVIEWED",
        sourceDocumentId: DOCUMENT,
        sourcePage: pageWithObjective,
        sourceText: "  COMPARE   fractions ",
      }),
    );
    expect(result.ok).toBe(true);
    const row = await service
      .from("supplemental_content")
      .select("source_type, verification_status, reviewed_by, source_page")
      .eq("id", (result as { id: string }).id)
      .single();
    expect(row.data).toMatchObject({
      source_type: "OFFICIAL_CURRICULUM",
      verification_status: "ADMIN_REVIEWED",
      reviewed_by: admin.id,
      source_page: pageWithObjective,
    });
  });

  it("refuses citations of unknown documents, impossible pages and pages without stored text", async () => {
    const official = {
      sourceType: "OFFICIAL_ASSESSMENT",
      verificationStatus: "ADMIN_REVIEWED",
      sourceText: "anything",
    };
    expect(
      await createSupplemental(
        service,
        admin.id,
        parse({ ...official, sourceDocumentId: "no-such-document", sourcePage: 3 }),
      ),
    ).toMatchObject({ ok: false, fieldErrors: { sourceDocumentId: expect.any(String) } });
    expect(
      await createSupplemental(
        service,
        admin.id,
        parse({ ...official, sourceDocumentId: DOCUMENT, sourcePage: 500 }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { sourcePage: expect.stringContaining("only 83 pages") },
    });
    expect(
      await verifyCitation(service, { documentId: DOCUMENT, page: 1, quote: "Ministry" }),
    ).toMatchObject({ ok: false }); // cover page has no body text
  });

  it("refuses to attach material to an objective that does not exist", async () => {
    expect(
      await createSupplemental(service, admin.id, parse({ objectiveId: "G5-NUM-NOT-A-THING-001" })),
    ).toMatchObject({ ok: false, error: expect.stringContaining("does not exist") });
  });

  it("relabels with a recorded before/after and reason, and clears a citation that no longer applies", async () => {
    const created = await createSupplemental(
      service,
      admin.id,
      parse({ body: "Generated explanation.", sourceType: "AI_GENERATED" }),
    );
    const id = (created as { id: string }).id;

    const rejected = await relabelSupplemental(
      service,
      admin.id,
      relabelInputSchema.parse({
        id,
        sourceType: "AI_GENERATED",
        verificationStatus: "REJECTED",
        reason: "uses fractions beyond Grade 5",
      }),
    );
    expect(rejected.ok).toBe(true);
    let row = await service
      .from("supplemental_content")
      .select("source_type, verification_status, reviewed_by")
      .eq("id", id)
      .single();
    expect(row.data).toMatchObject({
      source_type: "AI_GENERATED",
      verification_status: "REJECTED",
      reviewed_by: null,
    });

    const entry = (await listAuditLog(admin.db, 50)).find(
      (e) => e.entity_id === id && e.action === "SUPPLEMENTAL_RELABELLED",
    )!;
    expect(entry.before_state).toMatchObject({
      source_type: "AI_GENERATED",
      verification_status: "UNVERIFIED",
    });
    expect(entry.after_state).toMatchObject({
      verification_status: "REJECTED",
      reason: "uses fractions beyond Grade 5",
    });

    // Promote to official (with a real quotation), then demote: the citation goes with the label.
    const official = await relabelSupplemental(
      service,
      admin.id,
      relabelInputSchema.parse({
        id,
        sourceType: "OFFICIAL_CURRICULUM",
        verificationStatus: "ADMIN_REVIEWED",
        sourceDocumentId: DOCUMENT,
        sourcePage: pageWithObjective,
        sourceText: "compare fractions",
      }),
    );
    expect(official.ok).toBe(true);
    await relabelSupplemental(
      service,
      admin.id,
      relabelInputSchema.parse({
        id,
        sourceType: "SUPPLEMENTAL",
        verificationStatus: "ADMIN_REVIEWED",
      }),
    );
    row = await service
      .from("supplemental_content")
      .select("source_type, source_document_id, source_page, source_text")
      .eq("id", id)
      .single();
    expect(row.data).toEqual({
      source_type: "SUPPLEMENTAL",
      source_document_id: null,
      source_page: null,
      source_text: null,
    });
  });

  it("refuses to relabel something unofficial as official without the real wording", async () => {
    const created = await createSupplemental(service, admin.id, parse({}));
    const result = await relabelSupplemental(
      service,
      admin.id,
      relabelInputSchema.parse({
        id: (created as { id: string }).id,
        sourceType: "OFFICIAL_CURRICULUM",
        verificationStatus: "ADMIN_REVIEWED",
        sourceDocumentId: DOCUMENT,
        sourcePage: pageWithObjective,
        sourceText: "this is not in the syllabus",
      }),
    );
    expect(result).toMatchObject({ ok: false, fieldErrors: { sourceText: expect.any(String) } });
  });

  it("is backed by database constraints, not only by this code", async () => {
    const base = { objective_id: OBJECTIVE, kind: "NOTE", body: "x" };
    const official = await service.from("supplemental_content").insert({
      ...base,
      source_type: "OFFICIAL_CURRICULUM",
      verification_status: "ADMIN_REVIEWED",
    });
    expect(official.error?.code).toBe("23514"); // no document/page/quote
    const pipeline = await service.from("supplemental_content").insert({
      ...base,
      source_type: "SUPPLEMENTAL",
      verification_status: "VERIFIED_FROM_SOURCE",
    });
    expect(pipeline.error?.code).toBe("23514"); // reserved for the pipeline
    const ai = await service.from("supplemental_content").insert({
      ...base,
      source_type: "AI_GENERATED",
      verification_status: "VERIFIED_FROM_SOURCE",
    });
    expect(ai.error?.code).toBe("23514"); // AI output can never be "verified from source"
  });

  it("is invisible to anyone who is not an administrator", async () => {
    expect((await parent.from("supplemental_content").select("id")).data ?? []).toHaveLength(0);
    expect((await parent.from("admin_audit_log").select("id")).data ?? []).toHaveLength(0);
    expect((await listSupplemental(admin.db)).length).toBeGreaterThan(0);
    const insert = await parent
      .from("supplemental_content")
      .insert({ objective_id: OBJECTIVE, kind: "NOTE", body: "x" });
    expect(insert.error).not.toBeNull();
  });

  it("summarises content by label", async () => {
    const counts = await countSupplementalByLabel(admin.db);
    expect(counts.total).toBeGreaterThan(3);
    expect(
      Object.keys(counts.bySourceType).every((k) =>
        [
          "OFFICIAL_CURRICULUM",
          "OFFICIAL_ASSESSMENT",
          "SUPPLEMENTAL",
          "AI_GENERATED",
          "UNVERIFIED",
        ].includes(k),
      ),
    ).toBe(true);
  });
});
