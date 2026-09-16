-- 0027_exercise_media.sql
-- Reference-video pipe for the exercise screen (NTZ §16.1: reference video + sensor feedback on one
-- screen). Adds the column the catalog needs and a public, admin-managed storage bucket in the same
-- category as model-cards/dataset-manifests (0013_storage.sql) — exercise demo clips are non-PHI
-- reference content, not patient data. No actual video assets are uploaded by this migration; an
-- exercise with a null demo_video_url renders an honest "no reference video available" state
-- (components/session/ReferenceVideo.tsx) rather than a placeholder clip. Sourcing/recording/licensing
-- the clips themselves is a content task, not something this migration (or any code) can do.

alter table public.exercises add column if not exists demo_video_url text;
comment on column public.exercises.demo_video_url is
  'Public URL of the looping reference clip in the exercise-media bucket, or null if none exists yet.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-media', 'exercise-media', true, 104857600, array['video/mp4','video/webm'])
on conflict (id) do nothing;

drop policy if exists public_buckets_read on storage.objects;
create policy public_buckets_read on storage.objects for select to anon, authenticated
  using (bucket_id in ('model-cards', 'dataset-manifests', 'exercise-media'));

drop policy if exists public_buckets_write on storage.objects;
create policy public_buckets_write on storage.objects for all to authenticated
  using (bucket_id in ('model-cards', 'dataset-manifests', 'exercise-media') and (select app.is_admin()))
  with check (bucket_id in ('model-cards', 'dataset-manifests', 'exercise-media') and (select app.is_admin()));
