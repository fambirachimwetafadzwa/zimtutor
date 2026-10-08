-- ZimTutor: the question bank.
--
-- Practice questions are made by ZimTutor's own templates (src/lib/questions) and kept here so that
-- every attempt refers to a fixed question and a fixed answer key. They are NEVER official: they are
-- stored as SUPPLEMENTAL, UNVERIFIED material, tied to the objective they practise.
--
--   * questions.presentation   what the screen needs besides the stem: items to arrange, the two
--                              columns to match, the boxes of a multi-part answer, a note on how to
--                              write the answer. Nothing in it says what the right answer is.
--   * questions.generator_seed with generator ("template:<id>@<version>") it lets a question be
--                              re-created exactly, to audit it.
--   * bank_save_question()     the ONLY way a generated question enters the bank: question and key
--                              in one step, safe to repeat (the same content is stored once), and
--                              unable to label anything official.

alter table public.questions
  add column presentation jsonb not null default '{}'::jsonb
    check (jsonb_typeof(presentation) = 'object'),
  add column generator_seed text;

comment on column public.questions.presentation is
  'Learner-visible helpers: items, matching, answerFields, answerHint. Never contains correctness information.';
comment on column public.questions.generator_seed is
  'The seed that re-creates a template-generated question exactly (see questions.generator).';

create index questions_generator_idx on public.questions (generator);

-- Save a generated question and its key. Returns the question id (the existing one when the same
-- content was saved before: content_hash is unique).
create function public.bank_save_question(p_question jsonb, p_key jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_objective text := p_question ->> 'learning_objective_id';
  v_source public.content_source_type := (p_question ->> 'source_type')::public.content_source_type;
  v_status public.verification_status := (p_question ->> 'verification_status')::public.verification_status;
  v_grade smallint;
  v_topic text;
  v_subtopic text;
  v_id uuid;
begin
  -- Generated practice is never official, and nothing but the ingestion pipeline may claim to have
  -- verified it from the source.
  if v_source in ('OFFICIAL_CURRICULUM', 'OFFICIAL_ASSESSMENT') then
    raise exception 'generated questions cannot be labelled official (%)', v_source using errcode = '23514';
  end if;
  if v_status = 'VERIFIED_FROM_SOURCE' then
    raise exception 'generated questions cannot be VERIFIED_FROM_SOURCE' using errcode = '23514';
  end if;
  if coalesce(p_question ->> 'generator', '') = '' then
    raise exception 'a question needs a generator' using errcode = '23514';
  end if;

  select g.number, t.code, lo.subtopic_id
    into v_grade, v_topic, v_subtopic
  from public.learning_objectives lo
  join public.subtopics s on s.id = lo.subtopic_id
  join public.topics t on t.id = s.topic_id
  join public.grades g on g.id = t.grade_id
  where lo.id = v_objective;
  if v_grade is null then
    raise exception 'unknown learning objective %', v_objective using errcode = '23503';
  end if;

  insert into public.questions (
    learning_objective_id, grade, topic_code, subtopic_id, difficulty, question_type, assessment_skill,
    stem, stem_data, options, marking_method, misconception_tags, uses_local_context,
    source_type, verification_status, generator, generator_seed, presentation, content_hash
  ) values (
    v_objective, v_grade, v_topic, v_subtopic,
    (p_question ->> 'difficulty')::smallint,
    (p_question ->> 'question_type')::public.question_type,
    (p_question ->> 'assessment_skill')::public.assessment_skill,
    p_question ->> 'stem',
    coalesce(p_question -> 'stem_data', '{}'::jsonb),
    case when jsonb_typeof(p_question -> 'options') = 'array' then p_question -> 'options' end,
    (p_question ->> 'marking_method')::public.marking_method,
    coalesce(
      (select array_agg(tag) from jsonb_array_elements_text(p_question -> 'misconception_tags') as tag),
      '{}'::text[]
    ),
    coalesce((p_question ->> 'uses_local_context')::boolean, false),
    v_source, v_status,
    p_question ->> 'generator',
    p_question ->> 'generator_seed',
    coalesce(p_question -> 'presentation', '{}'::jsonb),
    p_question ->> 'content_hash'
  )
  on conflict (content_hash) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.questions where content_hash = p_question ->> 'content_hash';
    return v_id;
  end if;

  insert into public.question_keys (
    question_id, expected_answer, explanation, hints, solution_steps, solution_spec, distractor_map
  ) values (
    v_id,
    p_key -> 'expected_answer',
    p_key ->> 'explanation',
    coalesce(p_key -> 'hints', '[]'::jsonb),
    p_key -> 'solution_steps',
    p_key -> 'solution_spec',
    coalesce(p_key -> 'distractor_map', '{}'::jsonb)
  );
  return v_id;
end;
$$;

-- Server-only, like every function that writes learning content.
revoke execute on function public.bank_save_question(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.bank_save_question(jsonb, jsonb) to service_role;
