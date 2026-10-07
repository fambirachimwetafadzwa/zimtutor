-- ZimTutor 0009: protect the reserved learner identity namespace.
--
-- Learner sign-in identities live on the reserved domain learners.zimtutor.invalid and are created
-- only by the server (service role) with app_metadata.role = 'student'. Supabase's public sign-up
-- endpoint is callable by anyone with the anon key, so without this guard a stranger could
-- pre-register someone's future learner username (squatting it, or making provisioning fail).
-- app_metadata cannot be set through public sign-up, so it reliably identifies server-side creation.

create function public.reject_reserved_learner_emails() returns trigger
language plpgsql set search_path = '' as $$
begin
  if lower(new.email) like '%@learners.zimtutor.invalid'
     and coalesce(new.raw_app_meta_data ->> 'role', '') <> 'student' then
    raise exception 'this email domain is reserved' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger reject_reserved_learner_emails before insert or update of email on auth.users
  for each row execute function public.reject_reserved_learner_emails();

revoke execute on function public.reject_reserved_learner_emails() from public, anon, authenticated;
