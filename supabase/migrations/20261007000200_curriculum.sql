-- ZimTutor 0002: the curriculum model.
--
--   curricula
--   └── grades
--   └── subjects
--       └── topics                (per grade: "Grade 5 · Measures")
--           └── subtopics
--               └── competency_rows       one printed row of the syllabus competency matrix
--                   ├── learning_objectives   one bullet of the OBJECTIVES cell (smallest mastery unit)
--                   ├── curriculum_content        bullets of the CONTENT cell
--                   ├── curriculum_activities     bullets of SUGGESTED NOTES AND ACTIVITIES
--                   └── curriculum_resources      bullets of SUGGESTED RESOURCES
--
-- WHY competency_rows EXIST: the syllabus prints Objectives / Content / Activities / Resources as
-- parallel bullet lists inside one table row. There is no printed bullet-to-bullet pairing, so
-- content, activities and resources belong to the ROW, and every objective of that row shares them.
-- Attaching them to individual objectives would invent relationships the source does not state (or
-- duplicate text N times). The views v_objective_content / _activities / _resources give the
-- per-objective view without losing this fact.
--
-- Official tables accept ONLY source_type = OFFICIAL_CURRICULUM and
-- verification_status = VERIFIED_FROM_SOURCE; AI/supplemental material lives elsewhere.

-- ── Source documents ─────────────────────────────────────────────────────────────────────────
create table public.curriculum_documents (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  title text not null,
  organisation text not null,
  curriculum_year text not null,
  source_type public.content_source_type not null,
  verification_status public.verification_status not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  page_count integer not null check (page_count > 0),
  storage_path text,
  extractor_version text not null,
  ingested_at timestamptz not null default now(),
  constraint curriculum_documents_provenance check (
    public.provenance_ok(source_type, verification_status, 1, title)
  )
);

-- Page-preserving copy of the extracted text (supports audit and re-chunking).
create table public.curriculum_document_pages (
  document_id text not null references public.curriculum_documents (id) on delete cascade,
  page integer not null check (page >= 1),
  page_label text,
  text text not null,
  primary key (document_id, page)
);

-- ── Hierarchy ────────────────────────────────────────────────────────────────────────────────
create table public.curricula (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]*$'),
  name text not null,
  organisation text not null,
  curriculum_year text not null,
  document_id text not null references public.curriculum_documents (id),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.grades (
  id text primary key check (id ~ '^G[0-9]{1,2}$'),
  curriculum_id text not null references public.curricula (id) on delete cascade,
  number smallint not null check (number between 1 and 13),
  label text not null,
  unique (curriculum_id, number),
  constraint grades_id_matches_number check (id = 'G' || number::text)
);

create table public.subjects (
  id text primary key check (id ~ '^[A-Z]{2,8}$'),
  curriculum_id text not null references public.curricula (id) on delete cascade,
  name text not null,
  unique (curriculum_id, name)
);

-- A topic is per grade: "Grade 3 · Number (0 to 1 000)" and "Grade 4 · Number (0 to 10 000)" are
-- different rows, exactly as the syllabus prints separate competency matrices per grade.
create table public.topics (
  id text primary key check (id ~ '^G[0-9]{1,2}-(NUM|OPS|MEA|REL)$'),
  grade_id text not null references public.grades (id) on delete cascade,
  subject_id text not null references public.subjects (id),
  code text not null check (code in ('NUM', 'OPS', 'MEA', 'REL')),
  -- The four official topic names are preserved exactly as the syllabus spells them.
  name text not null check (name in ('Number', 'Operations', 'Measures', 'Relationships')),
  ordinal smallint not null check (ordinal between 1 and 4),
  section_number text not null,
  heading_text text not null,
  scope_text text,
  scope_max numeric,
  source_document_id text not null references public.curriculum_documents (id),
  source_page integer not null check (source_page >= 1),
  source_page_end integer,
  source_page_label text,
  source_text text not null check (length(btrim(source_text)) > 0),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  unique (grade_id, code),
  constraint topics_code_name_pair check (
    (code = 'NUM' and name = 'Number') or (code = 'OPS' and name = 'Operations')
    or (code = 'MEA' and name = 'Measures') or (code = 'REL' and name = 'Relationships')
  ),
  constraint topics_page_range check (source_page_end is null or source_page_end >= source_page)
);

create table public.subtopics (
  id text primary key check (id ~ '^G[0-9]{1,2}-(NUM|OPS|MEA|REL)-[A-Z0-9]+(-[A-Z0-9]+)*$'),
  topic_id text not null references public.topics (id) on delete cascade,
  ordinal smallint not null check (ordinal >= 1),
  -- verbatim composed name as printed (may include qualifiers such as "(0 – 1 000 000)").
  name text not null check (length(btrim(name)) > 0),
  -- DERIVED: the name without trailing qualifiers; used for filters and slugs.
  short_name text not null,
  slug text not null,
  -- The bold group heading printed above a sub-topic in the first matrix cell (e.g. "Whole numbers").
  -- Only set where the syllabus prints it; never propagated to neighbouring rows.
  group_name text,
  -- DERIVED: normalised key linking "the same" sub-topic across grades (progression/review).
  strand_key text not null,
  source_document_id text not null references public.curriculum_documents (id),
  source_page integer not null check (source_page >= 1),
  source_page_end integer,
  source_page_label text,
  source_text text not null check (length(btrim(source_text)) > 0),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  unique (topic_id, ordinal),
  unique (topic_id, slug),
  constraint subtopics_page_range check (source_page_end is null or source_page_end >= source_page)
);
create index subtopics_topic_idx on public.subtopics (topic_id, ordinal);
create index subtopics_strand_idx on public.subtopics (strand_key);

create table public.competency_rows (
  id text primary key,
  subtopic_id text not null references public.subtopics (id) on delete cascade,
  ordinal smallint not null check (ordinal >= 1),
  -- Verbatim text of each printed cell (audit trail; the bullets below are parsed from these).
  objectives_source_text text not null,
  content_source_text text not null default '',
  activities_source_text text not null default '',
  resources_source_text text not null default '',
  source_document_id text not null references public.curriculum_documents (id),
  source_page integer not null check (source_page >= 1),
  source_page_end integer,
  source_page_label text,
  source_text text not null check (length(btrim(source_text)) > 0),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  unique (subtopic_id, ordinal),
  -- Lets learning_objectives prove its row belongs to the same sub-topic (see below).
  unique (id, subtopic_id),
  constraint competency_rows_page_range check (source_page_end is null or source_page_end >= source_page)
);

create table public.learning_objectives (
  -- Stable internal identifier, e.g. G5-NUM-PROPER-FRACTIONS-002.
  -- An APPLICATION identifier: it is never presented as an official Ministry identifier.
  id text primary key check (id ~ '^G[0-9]{1,2}-(NUM|OPS|MEA|REL)-[A-Z0-9]+(-[A-Z0-9]+)*-[0-9]{3}$'),
  subtopic_id text not null,
  competency_row_id text not null,
  ordinal_in_subtopic smallint not null check (ordinal_in_subtopic >= 1),
  ordinal_in_row smallint not null check (ordinal_in_row >= 1),
  -- Official objective wording (the stem "Pupils should be able to:" is implied).
  text text not null check (length(btrim(text)) > 0),
  -- Detects wording drift under a stable id when the same document is re-ingested.
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  retired_at timestamptz,
  source_document_id text not null references public.curriculum_documents (id),
  source_page integer not null check (source_page >= 1),
  source_page_end integer,
  source_page_label text,
  source_text text not null check (length(btrim(source_text)) > 0),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  unique (subtopic_id, ordinal_in_subtopic),
  unique (competency_row_id, ordinal_in_row),
  -- An objective's row MUST belong to the objective's own sub-topic.
  foreign key (competency_row_id, subtopic_id)
    references public.competency_rows (id, subtopic_id) on delete cascade,
  foreign key (subtopic_id) references public.subtopics (id) on delete cascade,
  constraint learning_objectives_page_range check (source_page_end is null or source_page_end >= source_page)
);
create index learning_objectives_subtopic_idx on public.learning_objectives (subtopic_id, ordinal_in_subtopic);
create index learning_objectives_row_idx on public.learning_objectives (competency_row_id, ordinal_in_row);

-- Content / activities / resources: one table each, identical shape.
create table public.curriculum_content (
  id text primary key,
  competency_row_id text not null references public.competency_rows (id) on delete cascade,
  ordinal smallint not null check (ordinal >= 1),
  text text not null check (length(btrim(text)) > 0),
  source_document_id text not null references public.curriculum_documents (id),
  source_page integer not null check (source_page >= 1),
  source_page_end integer,
  source_page_label text,
  source_text text not null check (length(btrim(source_text)) > 0),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  unique (competency_row_id, ordinal)
);

create table public.curriculum_activities (
  id text primary key,
  competency_row_id text not null references public.competency_rows (id) on delete cascade,
  ordinal smallint not null check (ordinal >= 1),
  text text not null check (length(btrim(text)) > 0),
  source_document_id text not null references public.curriculum_documents (id),
  source_page integer not null check (source_page >= 1),
  source_page_end integer,
  source_page_label text,
  source_text text not null check (length(btrim(source_text)) > 0),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  unique (competency_row_id, ordinal)
);

create table public.curriculum_resources (
  id text primary key,
  competency_row_id text not null references public.competency_rows (id) on delete cascade,
  ordinal smallint not null check (ordinal >= 1),
  text text not null check (length(btrim(text)) > 0),
  source_document_id text not null references public.curriculum_documents (id),
  source_page integer not null check (source_page >= 1),
  source_page_end integer,
  source_page_label text,
  source_text text not null check (length(btrim(source_text)) > 0),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  unique (competency_row_id, ordinal)
);

-- ── Assessment (syllabus section 9) ───────────────────────────────────────────────────────────
-- Data, not code: the weightings in the application come from here, which come from the PDF.
create table public.assessment_components (
  id text primary key,
  curriculum_id text not null references public.curricula (id) on delete cascade,
  name text not null,
  weighting_percent numeric(5, 2) not null check (weighting_percent between 0 and 100),
  source_document_id text not null references public.curriculum_documents (id),
  source_page integer not null check (source_page >= 1),
  source_page_label text,
  source_text text not null check (length(btrim(source_text)) > 0),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE')
);

create table public.assessment_papers (
  id text primary key,
  curriculum_id text not null references public.curricula (id) on delete cascade,
  grade smallint not null check (grade between 1 and 13),
  paper_number smallint not null check (paper_number >= 1),
  description text not null,
  duration_minutes integer check (duration_minutes > 0),
  marks integer not null check (marks > 0),
  paper_weighting_percent numeric(5, 2) not null check (paper_weighting_percent between 0 and 100),
  summative_weighting_percent numeric(5, 2) check (summative_weighting_percent between 0 and 100),
  -- Structure facts stated in the prose below the table (question counts, sections, marks).
  structure jsonb not null default '{}'::jsonb,
  source_document_id text not null references public.curriculum_documents (id),
  source_page integer not null check (source_page >= 1),
  source_page_label text,
  source_text text not null check (length(btrim(source_text)) > 0),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  unique (curriculum_id, grade, paper_number)
);

-- The OFFICIAL specification grid has THREE skill bands (Application and Analysis is one band).
-- ZimTutor tags questions with FOUR skills; APPLICATION and ANALYSIS both map to the middle band.
create table public.assessment_skill_bands (
  id text primary key,
  curriculum_id text not null references public.curricula (id) on delete cascade,
  paper_number smallint not null check (paper_number >= 1),
  skill_band text not null,
  skill_band_code text not null
    check (skill_band_code in ('KNOWLEDGE_COMPREHENSION', 'APPLICATION_ANALYSIS', 'PROBLEM_SOLVING')),
  percent numeric(5, 2) not null check (percent between 0 and 100),
  source_document_id text not null references public.curriculum_documents (id),
  source_page integer not null check (source_page >= 1),
  source_page_label text,
  source_text text not null check (length(btrim(source_text)) > 0),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  unique (curriculum_id, paper_number, skill_band_code)
);

create table public.assessment_objectives (
  id text primary key,
  curriculum_id text not null references public.curricula (id) on delete cascade,
  code text not null,
  ordinal smallint not null check (ordinal >= 1),
  text text not null check (length(btrim(text)) > 0),
  source_document_id text not null references public.curriculum_documents (id),
  source_page integer not null check (source_page >= 1),
  source_page_label text,
  source_text text not null check (length(btrim(source_text)) > 0),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  unique (curriculum_id, code)
);

create table public.assessment_project_stages (
  id text primary key,
  curriculum_id text not null references public.curricula (id) on delete cascade,
  stage smallint not null check (stage >= 1),
  description text not null,
  timeline text,
  marks integer not null check (marks >= 0),
  source_document_id text not null references public.curriculum_documents (id),
  source_page integer not null check (source_page >= 1),
  source_page_label text,
  source_text text not null check (length(btrim(source_text)) > 0),
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  unique (curriculum_id, stage)
);

-- ── RAG chunks ────────────────────────────────────────────────────────────────────────────────
-- Retrieval is metadata-filtered first (grade/subject/topic/subtopic/objective), then ranked by
-- vector similarity and/or full-text relevance.
create table public.curriculum_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references public.curriculum_documents (id) on delete cascade,
  -- Deterministic key so re-ingestion upserts instead of duplicating, e.g. obj:G5-NUM-...-001
  chunk_key text not null,
  section_type text not null
    check (section_type in ('COMPETENCY_OBJECTIVE', 'SCOPE_AND_SEQUENCE', 'PREAMBLE', 'ASSESSMENT')),
  page integer not null check (page >= 1),
  page_end integer,
  grade smallint,
  subject text,
  topic text,
  topic_code text check (topic_code in ('NUM', 'OPS', 'MEA', 'REL')),
  subtopic text,
  subtopic_id text references public.subtopics (id) on delete set null,
  learning_objective_id text references public.learning_objectives (id) on delete set null,
  competency_row_id text references public.competency_rows (id) on delete set null,
  content text not null check (length(btrim(content)) > 0),
  content_hash text not null,
  source_type public.content_source_type not null default 'OFFICIAL_CURRICULUM'
    check (source_type = 'OFFICIAL_CURRICULUM'),
  verification_status public.verification_status not null default 'VERIFIED_FROM_SOURCE'
    check (verification_status = 'VERIFIED_FROM_SOURCE'),
  source_title text not null,
  curriculum_year text not null,
  embedding extensions.vector(1536),
  embedding_model text,
  embedded_at timestamptz,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  unique (document_id, chunk_key),
  constraint curriculum_chunks_embedding_pair check ((embedding is null) = (embedding_model is null))
);
create index curriculum_chunks_filter_idx on public.curriculum_chunks (grade, topic_code, subtopic_id);
create index curriculum_chunks_objective_idx on public.curriculum_chunks (learning_objective_id);
create index curriculum_chunks_fts_idx on public.curriculum_chunks using gin (fts);
create index curriculum_chunks_embedding_idx on public.curriculum_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

-- ── Audit views ───────────────────────────────────────────────────────────────────────────────
-- security_invoker: the views run with the caller's privileges, so row-level security of the
-- underlying tables still applies.
create view public.v_objective_context with (security_invoker = true) as
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
  lo.verification_status
from public.learning_objectives lo
join public.subtopics s on s.id = lo.subtopic_id
join public.topics t on t.id = s.topic_id
join public.grades g on g.id = t.grade_id
join public.subjects sj on sj.id = t.subject_id
join public.curriculum_documents d on d.id = lo.source_document_id;

create view public.v_objective_content with (security_invoker = true) as
select lo.id as objective_id, c.id as content_id, c.ordinal, c.text, c.source_page, c.source_text
from public.learning_objectives lo
join public.curriculum_content c on c.competency_row_id = lo.competency_row_id;

create view public.v_objective_activities with (security_invoker = true) as
select lo.id as objective_id, a.id as activity_id, a.ordinal, a.text, a.source_page, a.source_text
from public.learning_objectives lo
join public.curriculum_activities a on a.competency_row_id = lo.competency_row_id;

create view public.v_objective_resources with (security_invoker = true) as
select lo.id as objective_id, r.id as resource_id, r.ordinal, r.text, r.source_page, r.source_text
from public.learning_objectives lo
join public.curriculum_resources r on r.competency_row_id = lo.competency_row_id;

-- ── Row-level security: curriculum is world-readable to signed-in users, writable by no one ──
-- Only the ingestion pipeline (service role, which bypasses RLS) can change official curriculum.
do $$
declare t text;
begin
  foreach t in array array[
    'curriculum_documents', 'curriculum_document_pages', 'curricula', 'grades', 'subjects',
    'topics', 'subtopics', 'competency_rows', 'learning_objectives', 'curriculum_content',
    'curriculum_activities', 'curriculum_resources', 'assessment_components', 'assessment_papers',
    'assessment_skill_bands', 'assessment_objectives', 'assessment_project_stages',
    'curriculum_chunks'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_read', t
    );
  end loop;
end $$;

-- The full-page text copy is for admin auditing only; learners never need it.
drop policy curriculum_document_pages_read on public.curriculum_document_pages;
