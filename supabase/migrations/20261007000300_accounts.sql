-- ZimTutor 0003: accounts, roles and guardianship.
--
-- Child-safety posture:
--   * minimal personal data: a nickname, a grade, a username. No email for learners, no birth
--     date, no address, no location;
--   * learners are created by a parent/guardian (server-side, service role) and sign in with a
--     username + password; their auth identity uses a synthetic, non-deliverable address;
--   * role escalation is impossible from the client: roles come from raw_app_meta_data (server
--     only), never from raw_user_meta_data, and clients have no UPDATE privilege on profiles.role.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.learner_profiles (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  grade smallint not null check (grade between 3 and 7),
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9_.-]{2,23}$'),
  avatar text check (avatar is null or avatar ~ '^[a-z0-9-]{1,32}$'),
  created_by uuid references public.profiles (id) on delete set null,
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger learner_profiles_set_updated_at before update on public.learner_profiles
  for each row execute function public.set_updated_at();

create table public.guardianships (
  parent_id uuid not null references public.profiles (id) on delete cascade,
  learner_id uuid not null references public.learner_profiles (profile_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_id, learner_id)
);
create index guardianships_learner_idx on public.guardianships (learner_id);

-- ── Role integrity triggers ──────────────────────────────────────────────────────────────────
create function public.enforce_learner_profile_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.profile_id and role = 'student') then
    raise exception 'learner_profiles.profile_id must reference a profile with role student';
  end if;
  return new;
end;
$$;
create trigger learner_profiles_role_check before insert or update of profile_id
  on public.learner_profiles for each row execute function public.enforce_learner_profile_role();

create function public.enforce_guardianship_roles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.parent_id and role = 'parent') then
    raise exception 'guardianships.parent_id must reference a profile with role parent';
  end if;
  return new;
end;
$$;
create trigger guardianships_role_check before insert or update of parent_id, learner_id
  on public.guardianships for each row execute function public.enforce_guardianship_roles();

-- ── Authorisation helpers (SECURITY DEFINER so policies never recurse into profiles' own RLS) ──
create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid() and is_active), false)
$$;

create function public.is_guardian_of(p_learner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.guardianships g
    join public.profiles p on p.id = g.parent_id and p.is_active
    where g.parent_id = auth.uid() and g.learner_id = p_learner
  )
$$;

-- True when the signed-in user is this learner, one of the learner's guardians, or an admin.
create function public.can_view_learner(p_learner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() = p_learner or public.is_guardian_of(p_learner) or public.is_admin()
$$;

revoke execute on function public.current_app_role(), public.is_admin(),
  public.is_guardian_of(uuid), public.can_view_learner(uuid) from public;
grant execute on function public.current_app_role(), public.is_admin(),
  public.is_guardian_of(uuid), public.can_view_learner(uuid) to authenticated, service_role;

-- ── New auth users get a profile automatically ───────────────────────────────────────────────
-- raw_app_meta_data is writable only with the service role; raw_user_meta_data is writable by the
-- user themselves at sign-up, so the ROLE is never taken from it. Self-service sign-ups are
-- always parents. Learners are provisioned server-side with app_metadata.role = 'student'.
-- Admins are promoted out-of-band (npm run admin:promote), never by metadata.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := 'parent';
  v_name text;
begin
  if new.raw_app_meta_data ->> 'role' = 'student' then
    v_role := 'student';
  end if;
  v_name := left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 40);
  if v_name = '' then
    v_name := case v_role when 'student' then 'Learner' else 'Parent' end;
  end if;
  insert into public.profiles (id, role, display_name) values (new.id, v_role, v_name);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row-level security ───────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.learner_profiles enable row level security;
alter table public.guardianships enable row level security;

revoke all on public.profiles, public.learner_profiles, public.guardianships from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.profiles, public.learner_profiles, public.guardianships from authenticated;

-- Clients may change ONLY these columns (and only on rows the policies below allow).
grant update (display_name) on public.profiles to authenticated;
grant update (grade, avatar, onboarding_completed) on public.learner_profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_guardian_of(id) or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy learner_profiles_select on public.learner_profiles for select to authenticated
  using (public.can_view_learner(profile_id));
create policy learner_profiles_update on public.learner_profiles for update to authenticated
  using (profile_id = auth.uid() or public.is_guardian_of(profile_id))
  with check (profile_id = auth.uid() or public.is_guardian_of(profile_id));

create policy guardianships_select on public.guardianships for select to authenticated
  using (parent_id = auth.uid() or learner_id = auth.uid() or public.is_admin());

-- Admins may read the page-preserved source text (curriculum auditing).
create policy curriculum_document_pages_admin_read on public.curriculum_document_pages
  for select to authenticated using (public.is_admin());
