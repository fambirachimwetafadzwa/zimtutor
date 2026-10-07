-- ZimTutor 0010: structured facts stated in the assessment prose (e.g. "one school-based project per
-- grade"; "two projects at Grade 7, each 10%"), kept next to the component they describe.
alter table public.assessment_components
  add column details jsonb not null default '{}'::jsonb;
