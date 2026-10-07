-- ZimTutor 0013: per-topic counts for the curriculum browser (admin) and learner topic pages.
--
-- security_invoker: runs with the caller's privileges, so row-level security of the underlying
-- tables still applies. Retired sub-topics and objectives (see 0011) are not counted.
create view public.v_topic_summary with (security_invoker = true) as
select
  t.id as topic_id,
  g.id as grade_id,
  g.number as grade,
  t.code as topic_code,
  t.name as topic_name,
  t.ordinal as topic_ordinal,
  t.section_number,
  t.heading_text,
  t.scope_text,
  t.source_page,
  t.source_page_label,
  (select count(*) from public.subtopics s
    where s.topic_id = t.id and s.retired_at is null)::int as subtopic_count,
  (select count(*) from public.learning_objectives o
    join public.subtopics s on s.id = o.subtopic_id
    where s.topic_id = t.id and o.retired_at is null)::int as objective_count
from public.topics t
join public.grades g on g.id = t.grade_id;

-- Closed by default (see 0006): signed-in users may read; nobody writes; anonymous gets nothing.
revoke all on public.v_topic_summary from anon;
revoke insert, update, delete, truncate, references, trigger on public.v_topic_summary from authenticated;
