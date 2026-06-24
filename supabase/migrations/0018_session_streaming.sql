-- 0018_session_streaming.sql
-- Live edge-telemetry ingest: the browser runs the ONNX FoG/HAR graphs on-device
-- and streams DERIVED windows (keypoints + virtual-IMU summaries) and smoothed
-- freezing-of-gait episodes into session_frames / fog_events as a session runs.
--
-- These are the write half of the inference bridge. Like the 0017 self-serve RPCs
-- they are SECURITY DEFINER but strictly scoped to auth.uid(): the caller may only
-- write to a session owned by their own patient record, and patient_id/clinic_id
-- are derived server-side (never trusted from the client). RLS (can_access_patient)
-- still governs all direct table I/O for everything else.
-- PRIVACY: payloads carry derived keypoints + IMU features only — never raw video.

-- Batch-append per-frame telemetry to the high-volume session_frames time-series.
-- p_frames is a JSON array of {recorded_at, seq, joint_angles, keypoints, imu, quality}.
-- Returns the number of rows inserted. Idempotent on (session_id, recorded_at, seq).
create or replace function public.record_session_frames(
  p_session uuid,
  p_frames  jsonb
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_patient uuid;
  v_clinic  uuid;
  v_month   date;
  v_count   integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_frames is null or jsonb_typeof(p_frames) <> 'array' or jsonb_array_length(p_frames) = 0 then
    return 0;
  end if;

  select id, clinic_id into v_patient, v_clinic
  from public.patients where profile_id = v_uid;
  if v_patient is null then
    raise exception 'caller has no patient record' using errcode = '42501';
  end if;

  -- Ownership: the session must belong to the caller's own patient.
  if not exists (
    select 1 from public.sessions where id = p_session and patient_id = v_patient
  ) then
    raise exception 'session not found for caller' using errcode = '42501';
  end if;

  -- Ensure a monthly partition exists for every month present in the batch.
  for v_month in
    select distinct date_trunc('month', (f->>'recorded_at')::timestamptz)::date
    from jsonb_array_elements(p_frames) as f
  loop
    perform app.ensure_session_frames_partition(v_month);
  end loop;

  insert into public.session_frames (
    session_id, patient_id, clinic_id, recorded_at, seq, joint_angles, keypoints, imu, quality
  )
  select
    p_session, v_patient, v_clinic,
    (f->>'recorded_at')::timestamptz,
    (f->>'seq')::integer,
    nullif(f->'joint_angles', 'null'::jsonb),
    nullif(f->'keypoints',    'null'::jsonb),
    nullif(f->'imu',          'null'::jsonb),
    (f->>'quality')::numeric
  from jsonb_array_elements(p_frames) as f
  on conflict (session_id, recorded_at, seq) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function public.record_session_frames(uuid, jsonb) is
  'Batch-append derived per-frame telemetry to the caller''s own session_frames (auto-creates partitions).';

-- Batch-append smoothed freezing-of-gait episodes (or raw window events) to fog_events.
-- p_events is a JSON array of {kind, started_at, ended_at, confidence, freeze_index, source}.
-- Returns the number of rows inserted.
create or replace function public.record_fog_events(
  p_session uuid,
  p_events  jsonb
)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_patient uuid;
  v_clinic  uuid;
  v_count   integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then
    return 0;
  end if;

  select id, clinic_id into v_patient, v_clinic
  from public.patients where profile_id = v_uid;
  if v_patient is null then
    raise exception 'caller has no patient record' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.sessions where id = p_session and patient_id = v_patient
  ) then
    raise exception 'session not found for caller' using errcode = '42501';
  end if;

  insert into public.fog_events (
    session_id, patient_id, clinic_id, kind, started_at, ended_at, confidence, freeze_index, source
  )
  select
    p_session, v_patient, v_clinic,
    coalesce((e->>'kind')::public.fog_event_kind, 'episode'),
    (e->>'started_at')::timestamptz,
    (e->>'ended_at')::timestamptz,
    (e->>'confidence')::numeric,
    (e->>'freeze_index')::numeric,
    coalesce(e->>'source', 'fog.onnx')
  from jsonb_array_elements(p_events) as e;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function public.record_fog_events(uuid, jsonb) is
  'Batch-append detected freezing-of-gait events to the caller''s own session''s fog_events.';

grant execute on function public.record_session_frames(uuid, jsonb) to authenticated;
grant execute on function public.record_fog_events(uuid, jsonb)     to authenticated;
