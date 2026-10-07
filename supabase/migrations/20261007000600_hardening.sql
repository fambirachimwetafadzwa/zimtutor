-- ZimTutor 0006: privilege hardening ("closed by default").
--
-- Supabase grants every privilege on new public objects to the API roles (anon, authenticated) and
-- relies on RLS for protection. PostgREST also publishes every executable function in `public` as
-- an RPC endpoint. This migration removes everything the application does not deliberately need,
-- so a table/view/function added later is NOT reachable from the API until someone opts it in.

-- 1. Views: signed-in users may read; nobody may write; anonymous visitors get nothing.
revoke all on
  public.v_objective_context,
  public.v_objective_content,
  public.v_objective_activities,
  public.v_objective_resources
from anon;
revoke insert, update, delete, truncate, references, trigger on
  public.v_objective_context,
  public.v_objective_content,
  public.v_objective_activities,
  public.v_objective_resources
from authenticated;

-- 2. Sequences (identity columns): not directly usable by API roles.
revoke all on all sequences in schema public from anon, authenticated;

-- 3. Functions: close everything, then open an explicit allow-list.
revoke execute on all functions in schema public from public, anon, authenticated;

-- Authorisation helpers (needed by RLS policy expressions evaluated as the signed-in user).
grant execute on function
  public.current_app_role(),
  public.is_admin(),
  public.is_guardian_of(uuid),
  public.can_view_learner(uuid)
to authenticated;

-- Curriculum retrieval for the tutor (metadata-filtered; RLS still applies).
grant execute on function
  public.match_curriculum_chunks(extensions.vector, integer, smallint, text, text, text, text, double precision),
  public.search_curriculum_chunks_text(text, integer, smallint, text, text, text, text)
to authenticated;

-- The server (service role) keeps full access.
grant execute on all functions in schema public to service_role;
