-- 0013_storage.sql
-- Storage buckets + object RLS. Path conventions encode the owner so policies stay simple:
--   avatars/<user_id>/...
--   session-artifacts/<patient_id>/<session_id>/...   (derived artifacts only, no raw video)
--   reports/<clinic_id>/...                            (PDF outcome reports)
--   model-cards/... , dataset-manifests/...            (public, admin-managed)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars',           'avatars',           true,  5242880,  array['image/png','image/jpeg','image/webp']),
  ('session-artifacts', 'session-artifacts', false, 52428800, null),
  ('reports',           'reports',           false, 26214400, array['application/pdf']),
  ('model-cards',       'model-cards',       true,  10485760, null),
  ('dataset-manifests', 'dataset-manifests', true,  10485760, null)
on conflict (id) do nothing;

-- avatars: public read; users manage their own folder ------------------------
create policy avatars_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');
create policy avatars_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- session-artifacts: gated by patient access (folder 1 = patient_id) ----------
create policy session_artifacts_read on storage.objects for select to authenticated
  using (bucket_id = 'session-artifacts'
         and app.can_access_patient(((storage.foldername(name))[1])::uuid));
create policy session_artifacts_write on storage.objects for insert to authenticated
  with check (bucket_id = 'session-artifacts'
              and app.can_access_patient(((storage.foldername(name))[1])::uuid));
create policy session_artifacts_update on storage.objects for update to authenticated
  using (bucket_id = 'session-artifacts'
         and app.can_access_patient(((storage.foldername(name))[1])::uuid));
create policy session_artifacts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'session-artifacts'
         and app.can_access_patient(((storage.foldername(name))[1])::uuid));

-- reports: clinic-scoped (folder 1 = clinic_id) ------------------------------
create policy reports_read on storage.objects for select to authenticated
  using (bucket_id = 'reports'
         and app.is_clinic_member(((storage.foldername(name))[1])::uuid));
create policy reports_write on storage.objects for insert to authenticated
  with check (bucket_id = 'reports'
              and ((select app.is_clinician()))
              and app.is_clinic_member(((storage.foldername(name))[1])::uuid));
create policy reports_delete on storage.objects for delete to authenticated
  using (bucket_id = 'reports'
         and ((select app.is_clinician()))
         and app.is_clinic_member(((storage.foldername(name))[1])::uuid));

-- public catalog buckets: world-readable, admin-managed ----------------------
create policy public_buckets_read on storage.objects for select to anon, authenticated
  using (bucket_id in ('model-cards', 'dataset-manifests'));
create policy public_buckets_write on storage.objects for all to authenticated
  using (bucket_id in ('model-cards', 'dataset-manifests') and (select app.is_admin()))
  with check (bucket_id in ('model-cards', 'dataset-manifests') and (select app.is_admin()));
