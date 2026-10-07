import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";

export const HASH = "a".repeat(64);

/** A tiny but structurally complete curriculum: 1 document → grade → topic → sub-topic → row → 2 objectives. */
export async function seedMiniCurriculum(sql: Sql) {
  await sql`
    insert into public.curriculum_documents
      (id, title, organisation, curriculum_year, source_type, verification_status, sha256, page_count, extractor_version)
    values ('doc-1', 'Test Syllabus', 'MoPSE', '2024-2030', 'OFFICIAL_CURRICULUM', 'VERIFIED_FROM_SOURCE', ${HASH}, 10, 'test')`;
  await sql`
    insert into public.curricula (id, name, organisation, curriculum_year, document_id)
    values ('cur-1', 'Test Curriculum', 'MoPSE', '2024-2030', 'doc-1')`;
  await sql`insert into public.grades (id, curriculum_id, number, label) values ('G3', 'cur-1', 3, 'Grade 3'), ('G4', 'cur-1', 4, 'Grade 4')`;
  await sql`insert into public.subjects (id, curriculum_id, name) values ('MATH', 'cur-1', 'Mathematics')`;
  for (const [grade, id] of [["G3", "G3-NUM"], ["G4", "G4-NUM"]] as const) {
    await sql`
      insert into public.topics (id, grade_id, subject_id, code, name, ordinal, section_number, heading_text,
        source_document_id, source_page, source_text)
      values (${id}, ${grade}, 'MATH', 'NUM', 'Number', 1, '8.1', '8.1 (GRADE) TOPIC 1: NUMBER', 'doc-1', 5, 'heading')`;
  }
  await sql`
    insert into public.subtopics (id, topic_id, ordinal, name, short_name, slug, strand_key, source_document_id, source_page, source_text)
    values ('G3-NUM-PLACE-VALUE', 'G3-NUM', 1, 'Place value of digits', 'Place value of digits', 'PLACE-VALUE', 'place-value-of-digits', 'doc-1', 5, 'Place value of digits'),
           ('G4-NUM-PLACE-VALUE', 'G4-NUM', 1, 'Place value of digits', 'Place value of digits', 'PLACE-VALUE', 'place-value-of-digits', 'doc-1', 6, 'Place value of digits')`;
  await sql`
    insert into public.competency_rows (id, subtopic_id, ordinal, objectives_source_text, source_document_id, source_page, source_text)
    values ('G3-NUM-PLACE-VALUE.R1', 'G3-NUM-PLACE-VALUE', 1, 'identify the place value', 'doc-1', 5, 'row text'),
           ('G4-NUM-PLACE-VALUE.R1', 'G4-NUM-PLACE-VALUE', 1, 'identify the place value', 'doc-1', 6, 'row text')`;
  await sql`
    insert into public.learning_objectives
      (id, subtopic_id, competency_row_id, ordinal_in_subtopic, ordinal_in_row, text, text_hash, source_document_id, source_page, source_text)
    values
      ('G3-NUM-PLACE-VALUE-001', 'G3-NUM-PLACE-VALUE', 'G3-NUM-PLACE-VALUE.R1', 1, 1, 'identify the place value of each digit', ${HASH}, 'doc-1', 5, 'identify the place value of each digit'),
      ('G3-NUM-PLACE-VALUE-002', 'G3-NUM-PLACE-VALUE', 'G3-NUM-PLACE-VALUE.R1', 2, 2, 'compare the place value of digits', ${HASH}, 'doc-1', 5, 'compare the place value of digits'),
      ('G4-NUM-PLACE-VALUE-001', 'G4-NUM-PLACE-VALUE', 'G4-NUM-PLACE-VALUE.R1', 1, 1, 'identify the place value of each digit', ${HASH}, 'doc-1', 6, 'identify the place value of each digit')`;
  await sql`
    insert into public.curriculum_content (id, competency_row_id, ordinal, text, source_document_id, source_page, source_text)
    values ('G3-NUM-PLACE-VALUE.R1:CON01', 'G3-NUM-PLACE-VALUE.R1', 1, 'Place value', 'doc-1', 5, 'Place value')`;
}

export interface TestUsers {
  parentA: string;
  parentB: string;
  learnerA: string; // child of parentA
  learnerB: string; // child of parentB
  admin: string;
}

/** Create users the way the app does: self-signup parents, server-provisioned learners, promoted admin. */
export async function seedUsers(sql: Sql): Promise<TestUsers> {
  const ids = {
    parentA: randomUUID(),
    parentB: randomUUID(),
    learnerA: randomUUID(),
    learnerB: randomUUID(),
    admin: randomUUID(),
  };
  for (const [key, name] of [["parentA", "Parent A"], ["parentB", "Parent B"], ["admin", "Admin"]] as const) {
    await sql`insert into auth.users (id, email, raw_user_meta_data)
              values (${ids[key]}, ${key + "@example.test"}, ${sql.json({ display_name: name })})`;
  }
  for (const [key, name] of [["learnerA", "Tendai"], ["learnerB", "Rudo"]] as const) {
    await sql`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
              values (${ids[key]}, ${key + "@learners.zimtutor.invalid"}, ${sql.json({ display_name: name })}, ${sql.json({ role: "student" })})`;
  }
  await sql`update public.profiles set role = 'admin' where id = ${ids.admin}`;
  await sql`insert into public.learner_profiles (profile_id, grade, username, created_by)
            values (${ids.learnerA}, 3, 'tendai', ${ids.parentA}), (${ids.learnerB}, 4, 'rudo', ${ids.parentB})`;
  await sql`insert into public.guardianships (parent_id, learner_id)
            values (${ids.parentA}, ${ids.learnerA}), (${ids.parentB}, ${ids.learnerB})`;
  return ids;
}
