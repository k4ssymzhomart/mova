-- 0021_telemetry_streaming.sql
-- Single-roundtrip live telemetry flush.
--
-- The browser buffers DERIVED per-frame telemetry (keypoints + virtual-IMU summaries + model readout)
-- and smoothed freezing-of-gait episodes during a session, then flushes them in ONE batched call
-- (every ~2s / 100 frames, plus a keepalive flush on page-hide). This collapses the two 0018 RPCs
-- (record_session_frames + record_fog_events) into a single SECURITY DEFINER function, so a flush is
-- one network round-trip — the buffer never blocks the UI/capture thread waiting on the DB.
--
-- Security model is identical to 0018: SECURITY DEFINER with search_path pinned to '', the caller may
-- only write to a session owned by their OWN patient record, and patient_id/clinic_id are derived from
-- auth.uid() server-side (never trusted from the client). RLS still governs all other table I/O.
-- PRIVACY: payloads carry derived keypoints + IMU features only — never raw video.

create or replace function public.flush_session_telemetry_batch(
  p_session uuid,
  p_frames  jsonb default '[]'::jsonb,
  p_events  jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_patient uuid;
  v_clinic  uuid;
  v_month   date;
  v_frames  integer := 0;
  v_events  integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Resolve the caller's own patient + clinic (never trusted from the client).
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

  -- ── Frames ────────────────────────────────────────────────────────────────
  -- p_frames: [{recorded_at, seq, joint_angles, keypoints, imu, quality}, …]
  if p_frames is not null and jsonb_typeof(p_frames) = 'array' and jsonb_array_length(p_frames) > 0 then
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
    on conflict (session_id, recorded_at, seq) do nothing; -- idempotent on retry

    get diagnostics v_frames = row_count;
  end if;

  -- ── FoG episodes ──────────────────────────────────────────────────────────
  -- p_events: [{kind, started_at, ended_at, confidence, freeze_index, source}, …]
  if p_events is not null and jsonb_typeof(p_events) = 'array' and jsonb_array_length(p_events) > 0 then
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

    get diagnostics v_events = row_count;
  end if;

  return jsonb_build_object('frames', v_frames, 'events', v_events);
end;
$$;

comment on function public.flush_session_telemetry_batch(uuid, jsonb, jsonb) is
  'Single-roundtrip batched telemetry flush: bulk-inserts derived frames into session_frames and FoG episodes into fog_events for the caller''s own session (auto-creates monthly partitions). Idempotent on (session_id, recorded_at, seq).';

grant execute on function public.flush_session_telemetry_batch(uuid, jsonb, jsonb) to authenticated;
