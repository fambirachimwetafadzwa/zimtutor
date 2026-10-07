-- ZimTutor 0012: make account triggers correct for how Supabase Auth (GoTrue) really creates users.
--
-- GoTrue's admin createUser does NOT insert app_metadata with the row. It inserts the user first
-- (app_metadata holds only the provider info) and merges the caller's app_metadata afterwards, in
-- the same transaction. Two earlier decisions assumed the role was present at INSERT time:
--
--   * handle_new_user (0003) read app_metadata.role at insert, so a server-provisioned learner would
--     have received a PARENT profile;
--   * reject_reserved_learner_emails (0009) read it at insert, so creating a learner at all failed.
--
-- This was found by running the migrations under a real GoTrue + PostgREST, not the test shim.
--
-- Fix: the profile role follows app_metadata when it is merged afterwards, and the reserved-domain
-- guard becomes a DEFERRED constraint trigger evaluated at COMMIT, when the whole creation has
-- happened. Roles are still never taken from anything a user can write: raw_app_meta_data is
-- server-side only, and only the value 'student' is honoured here (administrators are promoted
-- out-of-band with `npm run admin:promote`).

-- ── 1. Profile role follows a later app_metadata.role = 'student' ─────────────────────────────
create function public.sync_profile_role_from_app_metadata() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.raw_app_meta_data ->> 'role' = 'student'
     and coalesce(old.raw_app_meta_data ->> 'role', '') <> 'student' then
    -- Only a fresh parent-by-default profile can become a learner: never an administrator, and
    -- never a parent who already has learners linked.
    update public.profiles set role = 'student'
    where id = new.id
      and role = 'parent'
      and not exists (select 1 from public.guardianships g where g.parent_id = new.id);
  end if;
  return new;
end;
$$;

create trigger sync_profile_role_from_app_metadata after update of raw_app_meta_data on auth.users
  for each row execute function public.sync_profile_role_from_app_metadata();

revoke execute on function public.sync_profile_role_from_app_metadata() from public, anon, authenticated;

-- ── 2. The reserved learner domain is checked at COMMIT ──────────────────────────────────────
drop trigger reject_reserved_learner_emails on auth.users;
drop function public.reject_reserved_learner_emails();

-- A deferred trigger sees NEW as it was when the statement ran, so the CURRENT row is re-read.
create function public.reject_reserved_learner_emails() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_role text;
begin
  select lower(u.email), u.raw_app_meta_data ->> 'role'
    into v_email, v_role
  from auth.users u
  where u.id = new.id;
  if v_email like '%@learners.zimtutor.invalid' and coalesce(v_role, '') <> 'student' then
    raise exception 'this email domain is reserved' using errcode = '42501';
  end if;
  return null;
end;
$$;

create constraint trigger reject_reserved_learner_emails
  after insert or update of email on auth.users
  deferrable initially deferred
  for each row execute function public.reject_reserved_learner_emails();

revoke execute on function public.reject_reserved_learner_emails() from public, anon, authenticated;
