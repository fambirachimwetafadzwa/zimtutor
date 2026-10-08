-- The order of the syllabus, for planning what a learner does next.
--
-- v_objective_context already says which topic, sub-topic and strand an objective belongs to; it did
-- not say where the topic and the sub-topic come in the syllabus. The adaptive planner walks the
-- syllabus in its printed order, so the two ordinals are added (at the end: CREATE OR REPLACE VIEW
-- may only append columns, and existing readers are unaffected).

create or replace view public.v_objective_context with (security_invoker = true) as
select
  lo.id as objective_id,
  lo.text as objective_text,
  lo.ordinal_in_subtopic,
  lo.ordinal_in_row,
  lo.retired_at,
  lo.competency_row_id,
  s.id as subtopic_id,
  s.name as subtopic_name,
  s.short_name as subtopic_short_name,
  s.group_name as subtopic_group_name,
  s.strand_key,
  t.id as topic_id,
  t.code as topic_code,
  t.name as topic_name,
  t.scope_text as topic_scope_text,
  g.id as grade_id,
  g.number as grade,
  sj.id as subject_id,
  sj.name as subject_name,
  d.id as source_document_id,
  d.title as source_title,
  d.organisation,
  d.curriculum_year,
  lo.source_page,
  lo.source_page_end,
  lo.source_page_label,
  lo.source_text,
  lo.source_type,
  lo.verification_status,
  t.ordinal as topic_ordinal,
  s.ordinal as subtopic_ordinal
from public.learning_objectives lo
join public.subtopics s on s.id = lo.subtopic_id
join public.topics t on t.id = s.topic_id
join public.grades g on g.id = t.grade_id
join public.subjects sj on sj.id = t.subject_id
join public.curriculum_documents d on d.id = lo.source_document_id;
