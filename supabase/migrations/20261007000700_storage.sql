-- ZimTutor 0007: private storage bucket for the official curriculum PDF.
--
-- Only runs where Supabase Storage exists (it is skipped on plain PostgreSQL, e.g. in tests).
-- The bucket is PRIVATE and readable only by admins, for curriculum auditing. Uploads are done by
-- the ingestion CLI with the service role (which bypasses these policies).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('curriculum-sources', 'curriculum-sources', false, 52428800, array['application/pdf'])
    on conflict (id) do nothing;

    execute $p$
      create policy curriculum_sources_admin_read on storage.objects
        for select to authenticated
        using (bucket_id = 'curriculum-sources' and public.is_admin())
    $p$;
  end if;
end $$;
