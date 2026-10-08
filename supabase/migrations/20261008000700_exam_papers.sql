-- ZimTutor: exam-style practice papers.
--
-- A practice paper is an assessment_set (the table exists since the learning migration): the questions
-- are chosen once, when the paper is started, and kept with the plan they were chosen for, so that the
-- paper can be redrawn, answered over several visits and marked exactly as it was built.
--
--   * assessment_sets   + the plan (sections, marks, shares aimed for and reached, shortfalls), the
--                         paper number and length, when it was started, and the result once marked.
--   * assessment_set_items + where a question sits (section, question number, part) and what the child
--                         answered, saved as they go. Marking happens once, when the paper is finished.
--   * one paper in progress per learner at a time.
--   * written only by the server (service role): a child cannot choose their own questions or marks.
--
-- ZimTutor practice scores are NEVER official ZIMSEC results; is_official_zimsec stays false (CHECK).

alter table public.assessment_sets
  add column paper_number smallint check (paper_number in (1, 2)),
  add column paper_length text not null default 'FULL' check (paper_length in ('FULL', 'SHORT')),
  add column plan jsonb,
  add column recommended_minutes integer check (recommended_minutes is null or recommended_minutes > 0),
  add column started_at timestamptz not null default now(),
  add column result jsonb;

create unique index assessment_sets_one_in_progress_idx
  on public.assessment_sets (learner_id) where status = 'IN_PROGRESS';

alter table public.assessment_set_items
  add column section text not null default 'A',
  add column question_number smallint not null default 1 check (question_number >= 1),
  add column part smallint not null default 1 check (part >= 1),
  add column answer jsonb,
  add column answered_at timestamptz,
  add column tags text[] not null default '{}';

comment on column public.assessment_sets.plan is
  'The paper as it was built: sections, marks, the skill shares aimed for and reached, any shortfall.';
comment on column public.assessment_sets.result is
  'The marked result (marks, shares by skill and topic, what to revisit). A ZimTutor practice score, never a ZIMSEC result.';
comment on column public.assessment_set_items.answer is
  'What the child answered, as the answer form sent it (free text screened for personal details).';

-- ── start a paper: the set and all its items, or nothing ─────────────────────────────────────────
-- p_set   {kind, grade, paper_number, paper_length, target_proportions, achieved_proportions,
--          marks_available, plan, recommended_minutes}
-- p_items [{position, question_id, marks, skill, section, question_number, part}]
-- Raises SQLSTATE PT409 when the learner already has a paper in progress.
create function public.exam_start(p_learner uuid, p_set jsonb, p_items jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if exists (select 1 from public.assessment_sets where learner_id = p_learner and status = 'IN_PROGRESS') then
    raise exception 'the learner already has a paper in progress' using errcode = 'PT409';
  end if;

  insert into public.assessment_sets (
    learner_id, kind, grade, paper_number, paper_length, target_proportions, achieved_proportions,
    marks_available, plan, recommended_minutes
  ) values (
    p_learner,
    p_set ->> 'kind',
    (p_set ->> 'grade')::smallint,
    (p_set ->> 'paper_number')::smallint,
    p_set ->> 'paper_length',
    p_set -> 'target_proportions',
    p_set -> 'achieved_proportions',
    (p_set ->> 'marks_available')::integer,
    p_set -> 'plan',
    nullif(p_set ->> 'recommended_minutes', '')::integer
  ) returning id into v_id;

  insert into public.assessment_set_items (
    set_id, position, question_id, marks, skill, section, question_number, part
  )
  select
    v_id,
    (e.value ->> 'position')::smallint,
    (e.value ->> 'question_id')::uuid,
    (e.value ->> 'marks')::smallint,
    (e.value ->> 'skill')::public.assessment_skill,
    e.value ->> 'section',
    (e.value ->> 'question_number')::smallint,
    (e.value ->> 'part')::smallint
  from jsonb_array_elements(p_items) as e(value);

  return v_id;
end;
$$;

revoke execute on function public.exam_start(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.exam_start(uuid, jsonb, jsonb) to service_role;
