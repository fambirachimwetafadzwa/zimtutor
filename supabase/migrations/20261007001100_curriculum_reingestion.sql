-- ZimTutor 0011: safe re-ingestion of the curriculum.
--
-- `curriculum:load` can be re-run (a corrected extraction, a reviewed override). It must never
-- delete an objective that learners have history against: mastery, attempts and tutor messages all
-- reference objectives with ON DELETE RESTRICT. Records that disappear from a re-extraction are
-- therefore RETIRED — kept, flagged with retired_at, and taken out of the active ordering — instead
-- of deleted.
--
-- To make that possible, ordinals only have to be unique among ACTIVE records. A retired objective
-- keeps its last ordinals purely as history; it no longer occupies a slot.

alter table public.subtopics add column retired_at timestamptz;

alter table public.subtopics drop constraint subtopics_topic_id_ordinal_key;
create unique index subtopics_active_ordinal
  on public.subtopics (topic_id, ordinal) where retired_at is null;

alter table public.learning_objectives drop constraint learning_objectives_subtopic_id_ordinal_in_subtopic_key;
alter table public.learning_objectives drop constraint learning_objectives_competency_row_id_ordinal_in_row_key;
create unique index learning_objectives_active_subtopic_ordinal
  on public.learning_objectives (subtopic_id, ordinal_in_subtopic) where retired_at is null;
create unique index learning_objectives_active_row_ordinal
  on public.learning_objectives (competency_row_id, ordinal_in_row) where retired_at is null;

-- A retired objective is never offered to learners (the application filters on retired_at).
create index learning_objectives_active_idx
  on public.learning_objectives (subtopic_id) where retired_at is null;
