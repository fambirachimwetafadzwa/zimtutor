import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getCurriculumDocument,
  getObjectiveDetail,
  getTopicMatrix,
  listTopicSummaries,
  searchObjectives,
} from "../../src/lib/curriculum/queries";
import { GRADES, TOPIC_CODES, topicSlug } from "../../src/lib/curriculum/schemas";
import { loadSnapshot } from "../ingestion/snapshot-fixture";

/**
 * The curriculum query layer through the real API, compared against the committed snapshot: every
 * grade, topic, sub-topic, row, objective, content, activity and resource must round-trip
 * (PDF → snapshot → database → PostgREST → query layer) in printed order.
 */

const URL = process.env.INTEGRATION_SUPABASE_URL;
const ANON = process.env.INTEGRATION_SUPABASE_ANON_KEY;
const configured = Boolean(URL && ANON && process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY);
const snapshot = loadSnapshot();

describe.skipIf(!configured)("curriculum queries through the real API", () => {
  let db: SupabaseClient;

  beforeAll(async () => {
    db = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await db.auth.signUp({
      email: `curriculum-${Date.now().toString(36)}@example.test`,
      password: "correct horse battery staple",
    });
    if (error) throw error;
  }, 30_000);

  it("lists the four official topics of every grade with the counts the snapshot has", async () => {
    const summaries = await listTopicSummaries(db);
    expect(summaries).toHaveLength(20);
    for (const grade of GRADES) {
      const topics = summaries.filter((t) => t.grade === grade);
      expect(topics.map((t) => t.topic_name)).toEqual([
        "Number",
        "Operations",
        "Measures",
        "Relationships",
      ]);
    }
    for (const t of summaries) {
      const snapshotSubtopics = snapshot.subtopics.filter((s) => s.topic_id === t.topic_id);
      expect(t.subtopic_count, t.topic_id).toBe(snapshotSubtopics.length);
      expect(t.objective_count, t.topic_id).toBe(
        snapshot.objectives.filter((o) => snapshotSubtopics.some((s) => s.id === o.subtopic_id))
          .length,
      );
    }
  });

  it("round-trips every topic exactly as the snapshot describes it, in printed order", async () => {
    let objectives = 0;
    for (const grade of GRADES) {
      for (const code of TOPIC_CODES) {
        const matrix = await getTopicMatrix(db, grade, code);
        expect(matrix, `${grade} ${code}`).not.toBeNull();
        const topicId = `G${grade}-${code}`;
        const expectedSubtopics = snapshot.subtopics.filter((s) => s.topic_id === topicId);
        expect(
          matrix!.subtopics.map((s) => s.id),
          topicId,
        ).toEqual(expectedSubtopics.map((s) => s.id));

        for (const subtopic of matrix!.subtopics) {
          const expectedRows = snapshot.competency_rows.filter(
            (r) => r.subtopic_id === subtopic.id,
          );
          expect(
            subtopic.competency_rows.map((r) => r.id),
            subtopic.id,
          ).toEqual(expectedRows.map((r) => r.id));
          for (const row of subtopic.competency_rows) {
            const text = (items: typeof snapshot.content) =>
              items.filter((i) => i.competency_row_id === row.id).map((i) => i.text);
            expect(
              row.learning_objectives.map((o) => o.text),
              row.id,
            ).toEqual(
              snapshot.objectives.filter((o) => o.competency_row_id === row.id).map((o) => o.text),
            );
            expect(
              row.curriculum_content.map((i) => i.text),
              row.id,
            ).toEqual(text(snapshot.content));
            expect(
              row.curriculum_activities.map((i) => i.text),
              row.id,
            ).toEqual(text(snapshot.activities));
            expect(
              row.curriculum_resources.map((i) => i.text),
              row.id,
            ).toEqual(text(snapshot.resources));
            objectives += row.learning_objectives.length;
          }
        }
      }
    }
    expect(objectives).toBe(444);
  });

  it("reports an unknown topic as absent rather than inventing one", async () => {
    expect(await getTopicMatrix(db, 9, "NUM")).toBeNull();
  });

  it("loads an objective with its full provenance, row content, siblings and tutor chunk", async () => {
    const detail = await getObjectiveDetail(db, "G5-NUM-PROPER-FRACTIONS-004");
    expect(detail).not.toBeNull();
    expect(detail!.context).toMatchObject({
      objective_text: "compare fractions",
      grade: 5,
      topic_name: "Number",
      subtopic_short_name: "Proper Fractions",
      source_type: "OFFICIAL_CURRICULUM",
      verification_status: "VERIFIED_FROM_SOURCE",
      source_title: "Revised Junior Mathematics Syllabus MoPSE 2024 - 2030",
    });
    expect(detail!.document).toMatchObject({
      id: "mopse-junior-mathematics-2024-2030",
      page_count: 83,
    });
    expect(detail!.row.id).toBe(detail!.context.competency_row_id);
    expect(detail!.row.curriculum_content.length).toBeGreaterThan(0);
    expect(detail!.siblings.map((s) => s.id)).toContain("G5-NUM-PROPER-FRACTIONS-004");
    expect(detail!.siblings.map((s) => s.ordinal_in_subtopic)).toEqual(
      detail!.siblings.map((_, i) => i + 1),
    );
    expect(detail!.chunk?.content).toContain(
      "Objective (pupils should be able to): compare fractions",
    );
  });

  it("returns null for an objective that does not exist", async () => {
    expect(await getObjectiveDetail(db, "G5-NUM-NOT-A-THING-001")).toBeNull();
  });

  it("finds objectives by their wording, and treats search punctuation as plain text", async () => {
    const hits = await searchObjectives(db, "compare fractions");
    expect(hits.map((h) => h.objective_id)).toContain("G5-NUM-PROPER-FRACTIONS-004");
    expect((await searchObjectives(db, "%")).length).toBe(0);
    expect(Array.isArray(await searchObjectives(db, "a,b).or(id.eq.x"))).toBe(true); // no filter injection
    expect(await searchObjectives(db, "x")).toEqual([]); // too short to be meaningful
  });

  it("describes the source document", async () => {
    const doc = await getCurriculumDocument(db);
    expect(doc).toMatchObject({
      title: "Revised Junior Mathematics Syllabus MoPSE 2024 - 2030",
      sha256: snapshot.document.sha256,
    });
  });

  it("exposes the topic slug helpers used in URLs", () => {
    expect(TOPIC_CODES.map(topicSlug)).toEqual(["num", "ops", "mea", "rel"]);
  });
});
