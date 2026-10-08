-- ZimTutor: tutor sessions that survive concurrent requests and half-finished work.
--
-- Every step of a lesson changes several things together: the session's position, the messages shown,
-- the attempt that was marked and the learner's mastery. tutor_commit() writes them in ONE transaction,
-- guarded by a revision number, so a double-click, a retry or a crash can never leave a half-applied
-- step (an attempt without its mastery update, or a mastery update counted twice).
--
--   * tutor_sessions.rev   compare-and-swap counter: a step commits only if nobody else moved the
--                          session since it was read.
--   * tutor_messages.meta  where the words came from (template or model), the syllabus quotation shown
--                          with a message, hint numbers ... never the child's private data.
--   * tutor_messages.seq   a strict order for messages written in one transaction (created_at ties).
--   * one ACTIVE session per learner and objective.

alter table public.tutor_sessions
  add column rev integer not null default 0 check (rev >= 0),
  add constraint tutor_sessions_phase_check check (
    phase in ('IDENTIFY_OBJECTIVE', 'LESSON', 'AWAITING_ANSWER', 'RESOLVED', 'ENDED')
  );

create unique index tutor_sessions_one_active_idx
  on public.tutor_sessions (learner_id, objective_id) where status = 'ACTIVE';

comment on column public.tutor_sessions.rev is
  'Incremented by every committed step. A step commits only against the revision it read.';

alter table public.tutor_messages
  add column meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  add column seq bigint generated always as identity;

alter table public.tutor_messages drop constraint tutor_messages_kind_check;
alter table public.tutor_messages add constraint tutor_messages_kind_check check (kind in (
  'IDENTIFY', 'INTRODUCE', 'EXPLAIN', 'WORKED_EXAMPLE', 'QUESTION', 'HINT', 'FEEDBACK',
  'CORRECTION', 'TRANSITION', 'ANSWER', 'LEARNER_ANSWER', 'LEARNER_MESSAGE', 'SAFETY'
));

drop index public.tutor_messages_session_idx;
create index tutor_messages_session_idx on public.tutor_messages (session_id, seq);

comment on column public.tutor_messages.meta is
  'Provenance of the words (template or model), the syllabus quotation shown, hint numbers. No personal data.';

-- A question is answered once per try; a repeated submission of the same try is refused.
create unique index question_attempts_try_idx
  on public.question_attempts (session_id, question_id, attempt_number) where session_id is not null;

-- ── one atomic step ──────────────────────────────────────────────────────────────────────────────
-- p_messages  [{role, kind, content, question_id?, flagged?, meta?}]   in display order
-- p_attempt   null | {question_id, objective_id, attempt_number, answer, is_correct, score, hints_used,
--                     marking_method, marking_detail, misconception_tags, time_taken_ms?, difficulty?}
-- p_mastery   null | {objective_id, expected_updated_at (null when the record is new), row {...},
--                     event? {question_id?, evidence, score_before, score_after, state_before,
--                             state_after, reason}}
-- Returns the session's new revision. SQLSTATE 40001 means "someone else changed it first": the caller
-- reads the session again and decides what to do.
create function public.tutor_commit(
  p_session_id uuid,
  p_expected_rev integer,
  p_phase text,
  p_state jsonb,
  p_status text,
  p_summary jsonb,
  p_messages jsonb,
  p_attempt jsonb,
  p_mastery jsonb
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_learner uuid;
  v_objective text;
  v_rev integer;
  v_count integer;
  v_question_objective text;
begin
  select learner_id, objective_id, rev into v_learner, v_objective, v_rev
  from public.tutor_sessions where id = p_session_id for update;
  if not found then
    raise exception 'unknown tutor session %', p_session_id using errcode = 'P0002';
  end if;
  if v_rev <> p_expected_rev then
    raise exception 'the tutor session has changed' using errcode = '40001';
  end if;

  update public.tutor_sessions set
    phase = p_phase,
    state = p_state,
    status = p_status,
    summary = coalesce(p_summary, summary),
    last_activity_at = now(),
    ended_at = case when p_status = 'ACTIVE' then null else coalesce(ended_at, now()) end,
    rev = v_rev + 1
  where id = p_session_id;

  if p_messages is not null and jsonb_array_length(p_messages) > 0 then
    insert into public.tutor_messages (session_id, learner_id, role, kind, content, question_id, flagged, meta)
    select
      p_session_id, v_learner,
      e.value ->> 'role', e.value ->> 'kind', e.value ->> 'content',
      nullif(e.value ->> 'question_id', '')::uuid,
      coalesce((e.value ->> 'flagged')::boolean, false),
      coalesce(e.value -> 'meta', '{}'::jsonb)
    from jsonb_array_elements(p_messages) with ordinality as e(value, n)
    order by e.n;
  end if;

  if p_attempt is not null then
    select learning_objective_id into v_question_objective
    from public.questions where id = (p_attempt ->> 'question_id')::uuid;
    if v_question_objective is distinct from (p_attempt ->> 'objective_id') then
      raise exception 'the question does not belong to the objective of the attempt' using errcode = '23514';
    end if;
    insert into public.question_attempts (
      learner_id, question_id, objective_id, session_id, attempt_number, answer, is_correct, score,
      hints_used, marking_method, marking_detail, misconception_tags, time_taken_ms, difficulty
    ) values (
      v_learner,
      (p_attempt ->> 'question_id')::uuid,
      p_attempt ->> 'objective_id',
      p_session_id,
      (p_attempt ->> 'attempt_number')::smallint,
      p_attempt -> 'answer',
      (p_attempt ->> 'is_correct')::boolean,
      (p_attempt ->> 'score')::numeric,
      coalesce((p_attempt ->> 'hints_used')::smallint, 0),
      (p_attempt ->> 'marking_method')::public.marking_method,
      coalesce(p_attempt -> 'marking_detail', '{}'::jsonb),
      coalesce(
        (select array_agg(tag) from jsonb_array_elements_text(p_attempt -> 'misconception_tags') as tag),
        '{}'::text[]
      ),
      nullif(p_attempt ->> 'time_taken_ms', '')::integer,
      nullif(p_attempt ->> 'difficulty', '')::smallint
    );
  end if;

  if p_mastery is not null then
    if p_mastery ->> 'expected_updated_at' is null then
      insert into public.learner_objective_mastery
      select * from jsonb_populate_record(
        null::public.learner_objective_mastery,
        (p_mastery -> 'row') || jsonb_build_object(
          'learner_id', v_learner,
          'objective_id', p_mastery ->> 'objective_id',
          'updated_at', now()
        )
      )
      on conflict (learner_id, objective_id) do nothing;
    else
      update public.learner_objective_mastery m set
        mastery_score = r.mastery_score,
        attempts = r.attempts,
        correct_attempts = r.correct_attempts,
        incorrect_attempts = r.incorrect_attempts,
        recent_accuracy = r.recent_accuracy,
        recent_outcomes = r.recent_outcomes,
        last_attempt_at = r.last_attempt_at,
        difficulty = r.difficulty,
        confidence = r.confidence,
        current_state = r.current_state,
        state_changed_at = r.state_changed_at,
        first_seen_at = r.first_seen_at,
        mastered_at = r.mastered_at,
        hard_correct = r.hard_correct,
        review_stage = r.review_stage,
        updated_at = now()
      from jsonb_populate_record(
        null::public.learner_objective_mastery, p_mastery -> 'row'
      ) as r
      where m.learner_id = v_learner
        and m.objective_id = p_mastery ->> 'objective_id'
        and m.updated_at = (p_mastery ->> 'expected_updated_at')::timestamptz;
    end if;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'the mastery record has changed' using errcode = '40001';
    end if;

    if p_mastery -> 'event' is not null then
      insert into public.mastery_events (
        learner_id, objective_id, question_id, evidence, score_before, score_after,
        state_before, state_after, reason
      ) values (
        v_learner,
        p_mastery ->> 'objective_id',
        nullif(p_mastery -> 'event' ->> 'question_id', '')::uuid,
        (p_mastery -> 'event' ->> 'evidence')::numeric,
        (p_mastery -> 'event' ->> 'score_before')::numeric,
        (p_mastery -> 'event' ->> 'score_after')::numeric,
        (p_mastery -> 'event' ->> 'state_before')::public.mastery_state,
        (p_mastery -> 'event' ->> 'state_after')::public.mastery_state,
        p_mastery -> 'event' ->> 'reason'
      );
    end if;
  end if;

  return v_rev + 1;
end;
$$;

-- Server-only, like every function that writes learning records.
revoke execute on function public.tutor_commit(uuid, integer, text, jsonb, text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.tutor_commit(uuid, integer, text, jsonb, text, jsonb, jsonb, jsonb, jsonb)
  to service_role;
