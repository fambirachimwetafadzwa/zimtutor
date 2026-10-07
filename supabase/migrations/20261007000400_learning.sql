-- ZimTutor 0004: learning data (mastery, questions, attempts, tutor sessions, supplemental
-- content, exam-style assessment sets).
--
-- Authority model
--   * Marking and mastery are computed by deterministic server code, then written with the
--     service role. Clients have NO write privileges on these tables, so a browser cannot
--     award itself mastery.
--   * Answer keys and progressive hints live in question_keys, which clients cannot read at all.
--   * Tutor chat messages are readable only by the learner who owns them. Parents see progress,
--     not conversations.

-- ── Misconception reference data ─────────────────────────────────────────────────────────────
create table public.misconceptions (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]+$'),
  name text not null,
  description text not null,
  topic_code text check (topic_code in ('NUM', 'OPS', 'MEA', 'REL')),
  remediation text not null
);

-- ── Objective-level mastery ──────────────────────────────────────────────────────────────────
create table public.learner_objective_mastery (
  learner_id uuid not null references public.learner_profiles (profile_id) on delete cascade,
  -- RESTRICT: mastery history must never silently disappear if curriculum rows are removed.
  objective_id text not null references public.learning_objectives (id) on delete restrict,
  mastery_score numeric(5, 4) not null default 0 check (mastery_score between 0 and 1),
  -- Counted per RESOLVED QUESTION (one observation per question, however many tries it took).
  attempts integer not null default 0 check (attempts >= 0),
  correct_attempts integer not null default 0 check (correct_attempts >= 0),
  incorrect_attempts integer not null default 0 check (incorrect_attempts >= 0),
  recent_accuracy numeric(5, 4) check (recent_accuracy between 0 and 1),
  -- Newest last; at most the last 10 independent outcomes (drives recent_accuracy).
  recent_outcomes boolean[] not null default '{}',
  last_attempt_at timestamptz,
  -- Target difficulty for the NEXT question (1 = easiest .. 5 = hardest).
  difficulty smallint not null default 1 check (difficulty between 1 and 5),
  confidence numeric(5, 4) not null default 0 check (confidence between 0 and 1),
  current_state public.mastery_state not null default 'NOT_STARTED',
  state_changed_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  mastered_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (learner_id, objective_id),
  constraint mastery_counts_consistent check (correct_attempts + incorrect_attempts = attempts),
  constraint mastery_recent_outcomes_len check (coalesce(array_length(recent_outcomes, 1), 0) <= 10)
);
create index mastery_learner_state_idx on public.learner_objective_mastery (learner_id, current_state);
create index mastery_objective_idx on public.learner_objective_mastery (objective_id);

-- Append-only history: powers "recent achievements", progress charts and audits of the engine.
create table public.mastery_events (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles (profile_id) on delete cascade,
  objective_id text not null references public.learning_objectives (id) on delete restrict,
  question_id uuid,
  evidence numeric(4, 3) not null check (evidence between 0 and 1),
  score_before numeric(5, 4) not null,
  score_after numeric(5, 4) not null,
  state_before public.mastery_state not null,
  state_after public.mastery_state not null,
  reason text,
  created_at timestamptz not null default now()
);
create index mastery_events_learner_idx on public.mastery_events (learner_id, created_at desc);

-- ── Questions ────────────────────────────────────────────────────────────────────────────────
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  learning_objective_id text not null references public.learning_objectives (id) on delete restrict,
  -- Denormalised tags required by the product spec. A trigger keeps them equal to the objective's.
  grade smallint not null check (grade between 3 and 7),
  topic_code text not null check (topic_code in ('NUM', 'OPS', 'MEA', 'REL')),
  subtopic_id text not null references public.subtopics (id),
  difficulty smallint not null check (difficulty between 1 and 5),
  question_type public.question_type not null,
  assessment_skill public.assessment_skill not null default 'KNOWLEDGE_COMPREHENSION',
  stem text not null check (length(btrim(stem)) > 0),
  -- Structured helper data (tables for data interpretation, diagram specifications, ...).
  stem_data jsonb not null default '{}'::jsonb,
  -- Learner-visible choices ONLY (no correctness information).
  options jsonb,
  marking_method public.marking_method not null,
  misconception_tags text[] not null default '{}',
  uses_local_context boolean not null default false,
  source_type public.content_source_type not null,
  verification_status public.verification_status not null default 'UNVERIFIED',
  -- e.g. 'template:add-whole-numbers@1' or 'llm:anthropic:<model>'
  generator text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED', 'NEEDS_REVIEW')),
  content_hash text not null unique,
  created_at timestamptz not null default now(),
  -- Source citation is mandatory for anything labelled official (see provenance_ok).
  source_document_id text references public.curriculum_documents (id),
  source_page integer,
  source_text text,
  constraint questions_provenance check (
    public.provenance_ok(source_type, verification_status, source_page, source_text)
  ),
  constraint questions_official_cites_document check (
    source_type not in ('OFFICIAL_CURRICULUM', 'OFFICIAL_ASSESSMENT') or source_document_id is not null
  )
);
create index questions_objective_idx on public.questions (learning_objective_id, difficulty)
  where status = 'ACTIVE';

create function public.questions_sync_tags() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_grade smallint;
  v_topic text;
  v_subtopic text;
begin
  select g.number, t.code, lo.subtopic_id
    into v_grade, v_topic, v_subtopic
  from public.learning_objectives lo
  join public.subtopics s on s.id = lo.subtopic_id
  join public.topics t on t.id = s.topic_id
  join public.grades g on g.id = t.grade_id
  where lo.id = new.learning_objective_id;
  if v_grade is null then
    raise exception 'unknown learning objective %', new.learning_objective_id;
  end if;
  if new.grade <> v_grade or new.topic_code <> v_topic or new.subtopic_id <> v_subtopic then
    raise exception 'question tags (grade %, topic %, subtopic %) do not match objective % (grade %, topic %, subtopic %)',
      new.grade, new.topic_code, new.subtopic_id, new.learning_objective_id, v_grade, v_topic, v_subtopic;
  end if;
  return new;
end;
$$;
create trigger questions_sync_tags before insert or update of learning_objective_id, grade, topic_code, subtopic_id
  on public.questions for each row execute function public.questions_sync_tags();

-- Server-only: the answer key, explanation and progressive hints.
create table public.question_keys (
  question_id uuid primary key references public.questions (id) on delete cascade,
  expected_answer jsonb not null,
  explanation text not null check (length(btrim(explanation)) > 0),
  -- Ordered hints, gentlest first. The server releases them one at a time.
  hints jsonb not null default '[]'::jsonb check (jsonb_typeof(hints) = 'array'),
  solution_steps jsonb,
  -- Structured description (operation, operands, ...) used by deterministic misconception diagnosis.
  solution_spec jsonb,
  -- Map: wrong option / wrong answer pattern -> misconception tag.
  distractor_map jsonb not null default '{}'::jsonb
);

-- ── Tutor sessions ───────────────────────────────────────────────────────────────────────────
create table public.tutor_sessions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles (profile_id) on delete cascade,
  objective_id text not null references public.learning_objectives (id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETED', 'ABANDONED')),
  -- Deterministic flow phase (see src/lib/tutor). The LLM never chooses the phase.
  phase text not null default 'IDENTIFY_OBJECTIVE',
  -- Serialisable flow state: ids and counters only. NO chat text (parents can read sessions).
  state jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Parent-safe summary (counts and outcomes, no conversation content).
  summary jsonb not null default '{}'::jsonb
);
create index tutor_sessions_learner_idx on public.tutor_sessions (learner_id, started_at desc);

create table public.tutor_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tutor_sessions (id) on delete cascade,
  -- Denormalised so the RLS policy needs no join.
  learner_id uuid not null references public.learner_profiles (profile_id) on delete cascade,
  role text not null check (role in ('tutor', 'learner', 'system')),
  kind text not null check (kind in (
    'IDENTIFY', 'INTRODUCE', 'EXPLAIN', 'WORKED_EXAMPLE', 'QUESTION', 'HINT', 'FEEDBACK',
    'CORRECTION', 'TRANSITION', 'LEARNER_ANSWER', 'LEARNER_MESSAGE', 'SAFETY'
  )),
  content text not null check (char_length(content) <= 8000),
  question_id uuid references public.questions (id) on delete set null,
  -- Set by the safety filter (e.g. attempted personal-data sharing); reviewable by admins only.
  flagged boolean not null default false,
  created_at timestamptz not null default now()
);
create index tutor_messages_session_idx on public.tutor_messages (session_id, created_at);

-- ── Attempts ─────────────────────────────────────────────────────────────────────────────────
create table public.question_attempts (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles (profile_id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete restrict,
  objective_id text not null references public.learning_objectives (id) on delete restrict,
  session_id uuid references public.tutor_sessions (id) on delete set null,
  -- 1 = first try at this question; 2 = second try after a hint; ...
  attempt_number smallint not null default 1 check (attempt_number >= 1),
  answer jsonb not null,
  is_correct boolean not null,
  score numeric(4, 3) not null default 0 check (score between 0 and 1),
  hints_used smallint not null default 0 check (hints_used >= 0),
  marking_method public.marking_method not null,
  -- Deterministic marking trace (parsed value, comparison, tolerance...). Never an LLM verdict.
  marking_detail jsonb not null default '{}'::jsonb,
  misconception_tags text[] not null default '{}',
  time_taken_ms integer check (time_taken_ms >= 0),
  difficulty smallint check (difficulty between 1 and 5),
  created_at timestamptz not null default now()
);
create index attempts_learner_idx on public.question_attempts (learner_id, created_at desc);
create index attempts_learner_objective_idx on public.question_attempts (learner_id, objective_id);

-- ── Supplemental, AI-generated and unverified content (admin-labelled) ────────────────────────
-- Never mixed into the official tables. OFFICIAL_* labels REQUIRE a source document and page.
create table public.supplemental_content (
  id uuid primary key default gen_random_uuid(),
  objective_id text references public.learning_objectives (id) on delete cascade,
  subtopic_id text references public.subtopics (id) on delete cascade,
  kind text not null check (kind in (
    'CONTENT', 'ACTIVITY', 'RESOURCE', 'EXPLANATION', 'WORKED_EXAMPLE', 'NOTE'
  )),
  title text,
  body text not null check (length(btrim(body)) > 0),
  source_type public.content_source_type not null default 'UNVERIFIED',
  verification_status public.verification_status not null default 'UNVERIFIED',
  source_document_id text references public.curriculum_documents (id),
  source_page integer check (source_page >= 1),
  source_text text,
  created_by uuid references public.profiles (id) on delete set null,
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplemental_attached check (objective_id is not null or subtopic_id is not null),
  constraint supplemental_provenance check (
    public.provenance_ok(source_type, verification_status, source_page, source_text)
  ),
  constraint supplemental_official_cites_document check (
    source_type not in ('OFFICIAL_CURRICULUM', 'OFFICIAL_ASSESSMENT') or source_document_id is not null
  ),
  -- VERIFIED_FROM_SOURCE is reserved for pipeline-extracted text; a human can only ADMIN_REVIEW.
  constraint supplemental_not_pipeline_verified check (verification_status <> 'VERIFIED_FROM_SOURCE')
);
create trigger supplemental_content_set_updated_at before update on public.supplemental_content
  for each row execute function public.set_updated_at();

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

-- ── Exam-style and formative assessment sets ─────────────────────────────────────────────────
create table public.assessment_sets (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles (profile_id) on delete cascade,
  kind text not null check (kind in ('FORMATIVE', 'EXAM_STYLE_PAPER_1', 'EXAM_STYLE_PAPER_2')),
  grade smallint not null check (grade between 3 and 7),
  -- Requested skill proportions (percent) and the proportions actually achieved.
  target_proportions jsonb not null,
  achieved_proportions jsonb,
  status text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS', 'COMPLETED')),
  marks_available integer,
  marks_awarded numeric(6, 2),
  -- ZimTutor practice scores are NEVER official ZIMSEC results; the database enforces it.
  is_official_zimsec boolean not null default false check (is_official_zimsec = false),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index assessment_sets_learner_idx on public.assessment_sets (learner_id, created_at desc);

create table public.assessment_set_items (
  set_id uuid not null references public.assessment_sets (id) on delete cascade,
  position smallint not null check (position >= 1),
  question_id uuid not null references public.questions (id) on delete restrict,
  marks smallint not null default 1 check (marks >= 1),
  skill public.assessment_skill not null,
  awarded numeric(4, 3),
  primary key (set_id, position)
);

-- ── Row-level security ───────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'misconceptions', 'learner_objective_mastery', 'mastery_events', 'questions', 'question_keys',
    'tutor_sessions', 'tutor_messages', 'question_attempts', 'supplemental_content',
    'admin_audit_log', 'assessment_sets', 'assessment_set_items'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    -- Clients never write these tables: all writes are server-side (service role).
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
  end loop;
end $$;

-- Reference data: readable by everyone signed in.
create policy misconceptions_read on public.misconceptions for select to authenticated using (true);

-- Learner progress: the learner, their guardians and admins.
create policy mastery_read on public.learner_objective_mastery for select to authenticated
  using (public.can_view_learner(learner_id));
create policy mastery_events_read on public.mastery_events for select to authenticated
  using (public.can_view_learner(learner_id));
create policy attempts_read on public.question_attempts for select to authenticated
  using (public.can_view_learner(learner_id));
create policy tutor_sessions_read on public.tutor_sessions for select to authenticated
  using (public.can_view_learner(learner_id));
create policy assessment_sets_read on public.assessment_sets for select to authenticated
  using (public.can_view_learner(learner_id));
create policy assessment_set_items_read on public.assessment_set_items for select to authenticated
  using (exists (
    select 1 from public.assessment_sets s
    where s.id = assessment_set_items.set_id and public.can_view_learner(s.learner_id)
  ));

-- PRIVATE conversations: only the learner. Admins see only messages the safety filter flagged.
create policy tutor_messages_read_own on public.tutor_messages for select to authenticated
  using (learner_id = auth.uid());
create policy tutor_messages_read_flagged_admin on public.tutor_messages for select to authenticated
  using (flagged and public.is_admin());

-- Questions and keys: no learner/parent access at all (the server returns a safe subset).
-- Admins may review questions (not keys) with their own session.
create policy questions_admin_read on public.questions for select to authenticated
  using (public.is_admin());
create policy supplemental_admin_read on public.supplemental_content for select to authenticated
  using (public.is_admin());
create policy audit_admin_read on public.admin_audit_log for select to authenticated
  using (public.is_admin());
-- question_keys: deliberately NO policy for authenticated => denied. Service role only.
-- Defence in depth: also revoke the SELECT privilege itself, so a policy added by mistake later
-- still cannot expose answer keys or hints to learners.
revoke all on public.question_keys from authenticated;
