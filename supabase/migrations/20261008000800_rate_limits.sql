-- ZimTutor: rate limits.
--
-- A counter for each thing being limited ("a bucket"), for each subject, for each time window. The
-- subject is never a name, an email address or an internet address: the application turns it into a
-- keyed hash before it gets here, so this table holds nothing that identifies a child or a family.
--
--   * windows are fixed and aligned to the clock, so every caller agrees on where one ends;
--   * a hit is counted and judged in one statement, so a crowd of simultaneous requests cannot all
--     slip under the limit;
--   * counters are of no use after their window, and are swept away.
--
-- Only the server (the service role) can call these functions or see the table.

create table public.rate_limit_counters (
  bucket       text        not null check (bucket ~ '^[a-z][a-z0-9_.]{1,59}$'),
  subject_hash text        not null check (length(subject_hash) between 16 and 128),
  window_start timestamptz not null,
  hits         integer     not null check (hits >= 0),
  primary key (bucket, subject_hash, window_start)
);

create index rate_limit_counters_window_idx on public.rate_limit_counters (window_start);

comment on table public.rate_limit_counters is
  'Rate-limit counters. subject_hash is a keyed hash made by the application: nothing here names anyone.';

alter table public.rate_limit_counters enable row level security;
-- no policies: no signed-in user can read or write it, whatever they ask for
revoke all on public.rate_limit_counters from anon, authenticated;

-- The start of the window that p_now falls in, for windows p_window_seconds long.
create function public.rate_limit_window(p_now timestamptz, p_window_seconds integer) returns timestamptz
language sql immutable set search_path = '' as $$
  select to_timestamp(floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds)
$$;

-- Count one hit and say whether it is within the limit. Hits beyond the limit are still counted
-- (the answer stays "no" until the window ends) but the window is never extended.
-- Returns: allowed, hits so far in this window, and how long until the window ends.
create function public.rate_limit_hit(
  p_bucket text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer,
  p_now timestamptz default now()
) returns table (allowed boolean, hits integer, retry_after_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'a rate limit needs a positive limit and window';
  end if;
  v_window := public.rate_limit_window(p_now, p_window_seconds);

  insert into public.rate_limit_counters as c (bucket, subject_hash, window_start, hits)
  values (p_bucket, p_subject, v_window, 1)
  on conflict (bucket, subject_hash, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hits;

  -- housekeeping, now and then, by whoever happens to be passing
  if random() < 0.02 then
    perform public.rate_limit_sweep(p_now);
  end if;

  return query select
    v_hits <= p_limit,
    v_hits,
    greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - p_now)))::integer);
end;
$$;

-- The same judgement without counting: for limits that only failures count against.
create function public.rate_limit_peek(
  p_bucket text,
  p_subject text,
  p_limit integer,
  p_window_seconds integer,
  p_now timestamptz default now()
) returns table (allowed boolean, hits integer, retry_after_seconds integer)
language plpgsql security definer stable set search_path = '' as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'a rate limit needs a positive limit and window';
  end if;
  v_window := public.rate_limit_window(p_now, p_window_seconds);
  select coalesce(max(c.hits), 0) into v_hits
    from public.rate_limit_counters c
   where c.bucket = p_bucket and c.subject_hash = p_subject and c.window_start = v_window;
  return query select
    v_hits < p_limit,
    v_hits,
    greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - p_now)))::integer);
end;
$$;

-- Forget a subject's count in a bucket (a successful sign-in ends the count of wrong guesses).
create function public.rate_limit_clear(p_bucket text, p_subject text) returns void
language sql security definer set search_path = '' as $$
  delete from public.rate_limit_counters where bucket = p_bucket and subject_hash = p_subject
$$;

-- Counters from windows that ended long ago are of no use to anyone.
create function public.rate_limit_sweep(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_removed integer;
begin
  delete from public.rate_limit_counters where window_start < p_now - interval '2 days';
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke execute on function public.rate_limit_window(timestamptz, integer) from public, anon, authenticated;
revoke execute on function public.rate_limit_hit(text, text, integer, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.rate_limit_peek(text, text, integer, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.rate_limit_clear(text, text) from public, anon, authenticated;
revoke execute on function public.rate_limit_sweep(timestamptz) from public, anon, authenticated;
grant execute on function public.rate_limit_window(timestamptz, integer) to service_role;
grant execute on function public.rate_limit_hit(text, text, integer, integer, timestamptz) to service_role;
grant execute on function public.rate_limit_peek(text, text, integer, integer, timestamptz) to service_role;
grant execute on function public.rate_limit_clear(text, text) to service_role;
grant execute on function public.rate_limit_sweep(timestamptz) to service_role;
