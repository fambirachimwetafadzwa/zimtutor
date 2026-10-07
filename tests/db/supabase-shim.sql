-- Minimal emulation of the parts of Supabase that our migrations depend on, so the migrations
-- and row-level-security policies can be tested against vanilla PostgreSQL (local or CI).
-- NOT applied to real Supabase projects (they already have all of this).

create schema if not exists auth;
create schema if not exists extensions;

do $$ begin create role anon nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

grant usage on schema public, extensions, auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

-- Supabase grants every privilege on new public objects to the API roles and relies on RLS (and
-- explicit REVOKEs) for protection. Reproduce that so tests prove our REVOKEs/policies really work.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
