-- ZimTutor 0008: atomic learner provisioning.
--
-- A parent creates a learner account from the app. Doing that touches the Auth API (create the
-- auth user) and two tables (learner_profiles + guardianships), which PostgREST cannot do in one
-- transaction. The database part is therefore a single function: both rows are created together
-- or not at all, and the per-parent learner limit is enforced here — under an advisory lock, so two
-- simultaneous requests cannot both slip past the limit.
--
-- Callable ONLY by the service role (the Next.js server, after it has authenticated the parent).

create function public.provision_learner_profile(
  p_learner uuid,
  p_parent uuid,
  p_grade smallint,
  p_username text,
  p_max_learners integer default 8
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_parent::text, 0));

  select count(*) into v_count from public.guardianships where parent_id = p_parent;
  if v_count >= p_max_learners then
    raise exception 'learner_limit_reached' using errcode = 'ZT001';
  end if;

  -- onboarding_completed = true: the parent chose the grade while creating the account.
  insert into public.learner_profiles (profile_id, grade, username, created_by, onboarding_completed)
  values (p_learner, p_grade, p_username, p_parent, true);

  insert into public.guardianships (parent_id, learner_id) values (p_parent, p_learner);
end;
$$;

revoke execute on function public.provision_learner_profile(uuid, uuid, smallint, text, integer)
  from public, anon, authenticated;
grant execute on function public.provision_learner_profile(uuid, uuid, smallint, text, integer)
  to service_role;
