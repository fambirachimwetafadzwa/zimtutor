-- ZimTutor 0005: retrieval functions for curriculum RAG.
--
-- Both functions are SECURITY INVOKER (the default): they run with the caller's privileges, so the
-- row-level security on curriculum_chunks still applies. Metadata filters are applied BEFORE
-- ranking so retrieval only ever sees material relevant to the current learning context.
--
-- Filters mirror the product spec: grade = 5, subject = 'mathematics', topic = 'measures',
-- subtopic = 'area' (lower-case names), or an exact learning_objective_id.

create function public.match_curriculum_chunks(
  query_embedding extensions.vector(1536),
  match_count integer default 8,
  filter_grade smallint default null,
  filter_subject text default null,
  filter_topic text default null,
  filter_subtopic text default null,
  filter_objective_id text default null,
  min_similarity double precision default 0
)
returns table (
  id uuid,
  chunk_key text,
  section_type text,
  page integer,
  page_end integer,
  grade smallint,
  subject text,
  topic text,
  subtopic text,
  subtopic_id text,
  learning_objective_id text,
  content text,
  source_title text,
  curriculum_year text,
  source_type public.content_source_type,
  similarity double precision
)
language sql stable
set search_path = public, extensions
as $$
  select
    c.id, c.chunk_key, c.section_type, c.page, c.page_end, c.grade, c.subject, c.topic, c.subtopic,
    c.subtopic_id, c.learning_objective_id, c.content, c.source_title, c.curriculum_year,
    c.source_type,
    1 - (c.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.curriculum_chunks c
  where c.embedding is not null
    and (filter_grade is null or c.grade = filter_grade)
    and (filter_subject is null or lower(c.subject) = lower(filter_subject))
    and (filter_topic is null or lower(c.topic) = lower(filter_topic))
    and (filter_subtopic is null or lower(c.subtopic) = lower(filter_subtopic))
    and (filter_objective_id is null or c.learning_objective_id = filter_objective_id)
    and 1 - (c.embedding operator(extensions.<=>) query_embedding) >= min_similarity
  order by c.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 50)
$$;

create function public.search_curriculum_chunks_text(
  query_text text,
  match_count integer default 8,
  filter_grade smallint default null,
  filter_subject text default null,
  filter_topic text default null,
  filter_subtopic text default null,
  filter_objective_id text default null
)
returns table (
  id uuid,
  chunk_key text,
  section_type text,
  page integer,
  page_end integer,
  grade smallint,
  subject text,
  topic text,
  subtopic text,
  subtopic_id text,
  learning_objective_id text,
  content text,
  source_title text,
  curriculum_year text,
  source_type public.content_source_type,
  rank real
)
language sql stable
set search_path = public, extensions
as $$
  select
    c.id, c.chunk_key, c.section_type, c.page, c.page_end, c.grade, c.subject, c.topic, c.subtopic,
    c.subtopic_id, c.learning_objective_id, c.content, c.source_title, c.curriculum_year,
    c.source_type,
    ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) as rank
  from public.curriculum_chunks c
  where c.fts @@ websearch_to_tsquery('english', query_text)
    and (filter_grade is null or c.grade = filter_grade)
    and (filter_subject is null or lower(c.subject) = lower(filter_subject))
    and (filter_topic is null or lower(c.topic) = lower(filter_topic))
    and (filter_subtopic is null or lower(c.subtopic) = lower(filter_subtopic))
    and (filter_objective_id is null or c.learning_objective_id = filter_objective_id)
  order by rank desc, c.chunk_key
  limit least(greatest(match_count, 1), 50)
$$;

revoke execute on function public.match_curriculum_chunks(
  extensions.vector, integer, smallint, text, text, text, text, double precision
) from public, anon;
revoke execute on function public.search_curriculum_chunks_text(
  text, integer, smallint, text, text, text, text
) from public, anon;
grant execute on function public.match_curriculum_chunks(
  extensions.vector, integer, smallint, text, text, text, text, double precision
) to authenticated, service_role;
grant execute on function public.search_curriculum_chunks_text(
  text, integer, smallint, text, text, text, text
) to authenticated, service_role;
