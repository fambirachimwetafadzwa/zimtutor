import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, expectPgError, TEST_DATABASE_URL, type TestDatabase } from "./harness";
import { HASH, seedMiniCurriculum, seedUsers, type TestUsers } from "./fixtures";

const CHECK_VIOLATION = "23514";
const FK_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

describe.skipIf(!TEST_DATABASE_URL)("database schema integrity", () => {
  let db: TestDatabase;
  let users: TestUsers;

  beforeAll(async () => {
    db = await createTestDatabase();
    await seedMiniCurriculum(db.sql);
    users = await seedUsers(db.sql);
  });
  afterAll(async () => {
    await db?.drop();
  });

  describe("provenance cannot be forged", () => {
    it("rejects AI_GENERATED content labelled VERIFIED_FROM_SOURCE", async () => {
      await expectPgError(
        db.sql`insert into public.supplemental_content (objective_id, kind, body, source_type, verification_status)
               values ('G3-NUM-PLACE-VALUE-001', 'EXPLANATION', 'x', 'AI_GENERATED', 'VERIFIED_FROM_SOURCE')`,
        CHECK_VIOLATION,
      );
    });

    it("rejects a human marking supplemental content VERIFIED_FROM_SOURCE (reserved for the pipeline)", async () => {
      await expectPgError(
        db.sql`insert into public.supplemental_content (objective_id, kind, body, source_type, verification_status, source_document_id, source_page, source_text)
               values ('G3-NUM-PLACE-VALUE-001', 'NOTE', 'x', 'SUPPLEMENTAL', 'VERIFIED_FROM_SOURCE', 'doc-1', 3, 'quote')`,
        CHECK_VIOLATION,
      );
    });

    it("requires a source document, page and text before content can be labelled OFFICIAL_*", async () => {
      await expectPgError(
        db.sql`insert into public.supplemental_content (objective_id, kind, body, source_type, verification_status)
               values ('G3-NUM-PLACE-VALUE-001', 'NOTE', 'x', 'OFFICIAL_CURRICULUM', 'ADMIN_REVIEWED')`,
        CHECK_VIOLATION,
      );
      await expectPgError(
        db.sql`insert into public.supplemental_content (objective_id, kind, body, source_type, verification_status, source_document_id, source_page)
               values ('G3-NUM-PLACE-VALUE-001', 'NOTE', 'x', 'OFFICIAL_ASSESSMENT', 'ADMIN_REVIEWED', 'doc-1', 3)`,
        CHECK_VIOLATION,
      );
    });

    it("accepts official labels only when a human cites the source", async () => {
      const rows = await db.sql`
        insert into public.supplemental_content (objective_id, kind, body, source_type, verification_status, source_document_id, source_page, source_text)
        values ('G3-NUM-PLACE-VALUE-001', 'NOTE', 'x', 'OFFICIAL_ASSESSMENT', 'ADMIN_REVIEWED', 'doc-1', 3, 'verbatim quote')
        returning id`;
      expect(rows).toHaveLength(1);
      await db.sql`delete from public.supplemental_content`;
    });

    it("keeps the official curriculum tables official-only", async () => {
      await expectPgError(
        db.sql`insert into public.curriculum_activities (id, competency_row_id, ordinal, text, source_document_id, source_page, source_text, source_type)
               values ('x:A01', 'G3-NUM-PLACE-VALUE.R1', 1, 'a', 'doc-1', 5, 'a', 'AI_GENERATED')`,
        CHECK_VIOLATION,
      );
      await expectPgError(
        db.sql`insert into public.curriculum_activities (id, competency_row_id, ordinal, text, source_document_id, source_page, source_text, verification_status)
               values ('x:A01', 'G3-NUM-PLACE-VALUE.R1', 1, 'a', 'doc-1', 5, 'a', 'UNVERIFIED')`,
        CHECK_VIOLATION,
      );
    });

    it("refuses curriculum items with no source page or no source text", async () => {
      await expectPgError(
        db.sql`insert into public.curriculum_activities (id, competency_row_id, ordinal, text, source_document_id, source_page, source_text)
               values ('x:A01', 'G3-NUM-PLACE-VALUE.R1', 1, 'a', 'doc-1', 0, 'a')`,
        CHECK_VIOLATION,
      );
      await expectPgError(
        db.sql`insert into public.curriculum_activities (id, competency_row_id, ordinal, text, source_document_id, source_page, source_text)
               values ('x:A01', 'G3-NUM-PLACE-VALUE.R1', 1, 'a', 'doc-1', 5, '   ')`,
        CHECK_VIOLATION,
      );
    });
  });

  describe("curriculum hierarchy integrity", () => {
    it("only allows the four official topic names, paired with their codes", async () => {
      await expectPgError(
        db.sql`insert into public.topics (id, grade_id, subject_id, code, name, ordinal, section_number, heading_text, source_document_id, source_page, source_text)
               values ('G3-OPS', 'G3', 'MATH', 'OPS', 'Number', 2, '8.2', 'h', 'doc-1', 5, 'h')`,
        CHECK_VIOLATION,
      );
      await expectPgError(
        db.sql`insert into public.topics (id, grade_id, subject_id, code, name, ordinal, section_number, heading_text, source_document_id, source_page, source_text)
               values ('G3-OPS', 'G3', 'MATH', 'OPS', 'Algebra', 2, '8.2', 'h', 'doc-1', 5, 'h')`,
        CHECK_VIOLATION,
      );
    });

    it("keeps grade ids consistent with grade numbers", async () => {
      await expectPgError(
        db.sql`insert into public.grades (id, curriculum_id, number, label) values ('G9', 'cur-1', 5, 'bad')`,
        CHECK_VIOLATION,
      );
    });

    it("rejects objective ids that do not follow the stable-id format", async () => {
      await expectPgError(
        db.sql`insert into public.learning_objectives (id, subtopic_id, competency_row_id, ordinal_in_subtopic, ordinal_in_row, text, text_hash, source_document_id, source_page, source_text)
               values ('bad-id', 'G3-NUM-PLACE-VALUE', 'G3-NUM-PLACE-VALUE.R1', 9, 9, 't', ${HASH}, 'doc-1', 5, 't')`,
        CHECK_VIOLATION,
      );
    });

    it("makes it impossible for an objective to point at another sub-topic's competency row", async () => {
      await expectPgError(
        db.sql`insert into public.learning_objectives (id, subtopic_id, competency_row_id, ordinal_in_subtopic, ordinal_in_row, text, text_hash, source_document_id, source_page, source_text)
               values ('G3-NUM-PLACE-VALUE-009', 'G3-NUM-PLACE-VALUE', 'G4-NUM-PLACE-VALUE.R1', 9, 9, 't', ${HASH}, 'doc-1', 5, 't')`,
        FK_VIOLATION,
      );
    });

    it("rejects duplicate objective ordinals within a sub-topic", async () => {
      await expectPgError(
        db.sql`insert into public.learning_objectives (id, subtopic_id, competency_row_id, ordinal_in_subtopic, ordinal_in_row, text, text_hash, source_document_id, source_page, source_text)
               values ('G3-NUM-PLACE-VALUE-010', 'G3-NUM-PLACE-VALUE', 'G3-NUM-PLACE-VALUE.R1', 1, 10, 't', ${HASH}, 'doc-1', 5, 't')`,
        UNIQUE_VIOLATION,
      );
    });

    it("exposes full provenance for auditing through v_objective_context", async () => {
      const [row] =
        await db.sql`select * from public.v_objective_context where objective_id = 'G3-NUM-PLACE-VALUE-001'`;
      expect(row).toMatchObject({
        grade: 3,
        topic_code: "NUM",
        topic_name: "Number",
        subtopic_name: "Place value of digits",
        subject_name: "Mathematics",
        source_title: "Test Syllabus",
        organisation: "MoPSE",
        curriculum_year: "2024-2030",
        source_page: 5,
        source_type: "OFFICIAL_CURRICULUM",
        verification_status: "VERIFIED_FROM_SOURCE",
      });
    });

    it("shares a row's content with each of its objectives (per-objective views)", async () => {
      const rows =
        await db.sql`select objective_id from public.v_objective_content order by objective_id`;
      expect(rows.map((r) => r.objective_id)).toEqual([
        "G3-NUM-PLACE-VALUE-001",
        "G3-NUM-PLACE-VALUE-002",
      ]);
    });
  });

  describe("learning data integrity", () => {
    it("keeps mastery counters consistent", async () => {
      await expectPgError(
        db.sql`insert into public.learner_objective_mastery (learner_id, objective_id, attempts, correct_attempts, incorrect_attempts)
               values (${users.learnerA}, 'G3-NUM-PLACE-VALUE-001', 3, 1, 1)`,
        CHECK_VIOLATION,
      );
    });

    it("only keeps the last 10 outcomes", async () => {
      await expectPgError(
        db.sql`insert into public.learner_objective_mastery (learner_id, objective_id, recent_outcomes)
               values (${users.learnerA}, 'G3-NUM-PLACE-VALUE-001', ${db.sql.array(Array(11).fill(true))})`,
        CHECK_VIOLATION,
      );
    });

    it("forces question tags to match the objective they belong to", async () => {
      await expectPgError(
        db.sql`insert into public.questions (learning_objective_id, grade, topic_code, subtopic_id, difficulty, question_type, stem, marking_method, source_type, generator, content_hash)
               values ('G3-NUM-PLACE-VALUE-001', 5, 'NUM', 'G3-NUM-PLACE-VALUE', 1, 'NUMERIC', 'q', 'EXACT_NUMERIC', 'SUPPLEMENTAL', 't', 'h1')`,
        "P0001",
      );
      const [ok] = await db.sql`
        insert into public.questions (learning_objective_id, grade, topic_code, subtopic_id, difficulty, question_type, stem, marking_method, source_type, generator, content_hash)
        values ('G3-NUM-PLACE-VALUE-001', 3, 'NUM', 'G3-NUM-PLACE-VALUE', 1, 'NUMERIC', 'q', 'EXACT_NUMERIC', 'SUPPLEMENTAL', 't', 'h2')
        returning id`;
      expect(ok?.id).toBeTruthy();
      await db.sql`delete from public.questions where content_hash = 'h2'`;
    });

    it("never lets AI-generated questions be marked VERIFIED_FROM_SOURCE or official without a source", async () => {
      await expectPgError(
        db.sql`insert into public.questions (learning_objective_id, grade, topic_code, subtopic_id, difficulty, question_type, stem, marking_method, source_type, verification_status, generator, content_hash)
               values ('G3-NUM-PLACE-VALUE-001', 3, 'NUM', 'G3-NUM-PLACE-VALUE', 1, 'NUMERIC', 'q', 'EXACT_NUMERIC', 'AI_GENERATED', 'VERIFIED_FROM_SOURCE', 't', 'h3')`,
        CHECK_VIOLATION,
      );
      await expectPgError(
        db.sql`insert into public.questions (learning_objective_id, grade, topic_code, subtopic_id, difficulty, question_type, stem, marking_method, source_type, verification_status, generator, content_hash)
               values ('G3-NUM-PLACE-VALUE-001', 3, 'NUM', 'G3-NUM-PLACE-VALUE', 1, 'NUMERIC', 'q', 'EXACT_NUMERIC', 'OFFICIAL_ASSESSMENT', 'ADMIN_REVIEWED', 't', 'h4')`,
        CHECK_VIOLATION,
      );
    });

    it("can never record an internal practice set as an official ZIMSEC result", async () => {
      await expectPgError(
        db.sql`insert into public.assessment_sets (learner_id, kind, grade, target_proportions, is_official_zimsec)
               values (${users.learnerA}, 'EXAM_STYLE_PAPER_1', 3, ${db.sql.json({})}, true)`,
        CHECK_VIOLATION,
      );
    });

    it("limits learner usernames and grades to safe values", async () => {
      await expectPgError(
        db.sql`update public.learner_profiles set grade = 8 where profile_id = ${users.learnerA}`,
        CHECK_VIOLATION,
      );
      await expectPgError(
        db.sql`update public.learner_profiles set username = 'Bad Name!' where profile_id = ${users.learnerA}`,
        CHECK_VIOLATION,
      );
    });

    it("only lets a student profile become a learner, and only a parent become a guardian", async () => {
      await expectPgError(
        db.sql`insert into public.learner_profiles (profile_id, grade, username) values (${users.parentA}, 3, 'notakid')`,
        "P0001",
      );
      await expectPgError(
        db.sql`insert into public.guardianships (parent_id, learner_id) values (${users.learnerA}, ${users.learnerB})`,
        "P0001",
      );
    });
  });
});
