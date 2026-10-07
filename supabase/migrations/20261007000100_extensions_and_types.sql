-- ZimTutor 0001: extensions, shared enum types and helper functions.
--
-- Conventions
--   * Curriculum entities use stable TEXT identifiers (application identifiers, NOT Ministry IDs).
--   * User-generated entities use UUIDs.
--   * Every table has row-level security enabled in the same migration that creates it.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- ── Content provenance ───────────────────────────────────────────────────────────────────────
-- The five categories the product must never mix silently.
create type public.content_source_type as enum (
  'OFFICIAL_CURRICULUM',
  'OFFICIAL_ASSESSMENT',
  'SUPPLEMENTAL',
  'AI_GENERATED',
  'UNVERIFIED'
);

-- VERIFIED_FROM_SOURCE is reserved for text the ingestion pipeline extracted from the official
-- document. ADMIN_REVIEWED is a human decision about supplemental content.
create type public.verification_status as enum (
  'VERIFIED_FROM_SOURCE',
  'ADMIN_REVIEWED',
  'UNVERIFIED',
  'REJECTED'
);

-- ── Accounts ─────────────────────────────────────────────────────────────────────────────────
create type public.app_role as enum ('student', 'parent', 'admin');

-- ── Learning ─────────────────────────────────────────────────────────────────────────────────
create type public.mastery_state as enum (
  'NOT_STARTED',
  'INTRODUCED',
  'LEARNING',
  'PRACTICING',
  'DEVELOPING',
  'MASTERED',
  'REVIEW'
);

create type public.question_type as enum (
  'MULTIPLE_CHOICE',
  'NUMERIC',
  'SHORT_ANSWER',
  'WORKED_CALCULATION',
  'TRUE_FALSE',
  'ORDERING',
  'MATCHING',
  'FILL_IN_THE_BLANK',
  'WORD_PROBLEM',
  'VISUAL_DIAGRAM',
  'DATA_INTERPRETATION'
);

-- How an answer is marked. Everything except MANUAL_REVIEW is deterministic code; an LLM never
-- appears in this list because an LLM is never allowed to decide correctness.
create type public.marking_method as enum (
  'EXACT_NUMERIC',
  'EXPRESSION_EQUIVALENT',
  'FRACTION_EQUIVALENT',
  'FRACTION_LOWEST_TERMS',
  'NUMERIC_WITH_UNIT',
  'MULTIPLE_CHOICE',
  'TRUE_FALSE',
  'ORDERED_SEQUENCE',
  'MATCHING_PAIRS',
  'TEXT_NORMALISED',
  'MULTI_PART',
  'MANUAL_REVIEW'
);

-- The four assessment skills named in the product spec. The official specification grid groups
-- APPLICATION and ANALYSIS into a single band; see assessment_skill_bands.
create type public.assessment_skill as enum (
  'KNOWLEDGE_COMPREHENSION',
  'APPLICATION',
  'ANALYSIS',
  'PROBLEM_SOLVING'
);

-- ── Helper functions ────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Provenance integrity, enforced by CHECK constraints on every table that carries a source_type:
--   * OFFICIAL_* content must cite a page and carry verbatim source text, and may only be
--     VERIFIED_FROM_SOURCE or ADMIN_REVIEWED;
--   * AI_GENERATED content can never be VERIFIED_FROM_SOURCE.
create or replace function public.provenance_ok(
  st public.content_source_type,
  vs public.verification_status,
  pg integer,
  txt text
) returns boolean
language sql immutable as $$
  select case
    when st in ('OFFICIAL_CURRICULUM', 'OFFICIAL_ASSESSMENT') then
      vs in ('VERIFIED_FROM_SOURCE', 'ADMIN_REVIEWED')
      and pg is not null and pg >= 1
      and txt is not null and length(btrim(txt)) > 0
    when st = 'AI_GENERATED' then vs <> 'VERIFIED_FROM_SOURCE'
    else true
  end
$$;
