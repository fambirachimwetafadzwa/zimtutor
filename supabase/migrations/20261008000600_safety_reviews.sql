-- ZimTutor: a person looks at what the safety screen flagged.
--
-- The screen (src/lib/ai/safety.ts) flags a child's message that sounds worrying or that held personal
-- details. It is a net, not a guarantee; this table is the other half of it: an administrator reads each
-- flagged message (already stripped of personal details), decides, and records what they decided. A
-- flagged message with no review is still open and is listed first.
--
--   * one review per message; reviewing again replaces it (the audit log keeps every version);
--   * outcome: NO_CONCERN (nothing to do) or ACTION_TAKEN (followed up under the operator's own
--     safeguarding procedure -- the application does not contact anyone);
--   * written only by the server after an administrator is verified; administrators may read it.

create table public.safety_reviews (
  message_id uuid primary key references public.tutor_messages (id) on delete cascade,
  reviewed_by uuid references public.profiles (id) on delete set null,
  outcome text not null check (outcome in ('NO_CONCERN', 'ACTION_TAKEN')),
  note text check (note is null or char_length(note) <= 1000),
  reviewed_at timestamptz not null default now()
);

alter table public.safety_reviews enable row level security;
revoke all on public.safety_reviews from anon;
revoke insert, update, delete, truncate, references, trigger on public.safety_reviews from authenticated;

create policy safety_reviews_admin_read on public.safety_reviews for select to authenticated
  using (public.is_admin());

comment on table public.safety_reviews is
  'An administrator''s decision about a message the safety screen flagged. Server-written only.';
