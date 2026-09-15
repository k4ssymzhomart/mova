-- 0034_heel_slide_path.sql
-- The database half of the Heel Slide path: a patient starts a session from their own active prescription,
-- streams real IMU frames through flush_session_telemetry_batch (redefined here), finishes with
-- finish_prescribed_session, answers a short check-in, and a clinician opens that one session.
--
-- Numbered above #24's 0023–0033 range. #24 (tenancy fix, exercise_configs) is not applied and not merged, and
-- nothing here depends on it: Heel Slide's engineering config lives in the existing exercises.scoring_rubric
-- jsonb until #20 moves it. Note for the PR: #24's 0023_tenancy_fix and #25's 0023_patient_ble_devices collide on
-- the version number; that is resolved there, not here.
--
-- Authorization for the clinician reads is deliberately NOT clinic-membership equality (the #20 hole in 0022's
-- clinic_* RPCs, where any member of the shared self-serve clinic sees every patient). A clinician needs an
-- active care_team_link to the patient; a clinic_admin needs the patient's clinic; a platform admin sees all.
--
-- A prescribed session only moves forward: in_progress → completed (finish_prescribed_session) or in_progress →
-- aborted (a newer start of the same prescription supersedes it). A finished session is never finished again,
-- and rows recorded after it ended are not added to it.
--
-- Honesty: nothing here computes a score or a knee angle. clinician_session_result returns the stored
-- orientation pitch per sensor as recorded; the caller derives the relative, uncalibrated proxy and labels it.

-- Catalog ----------------------------------------------------------------------------------------------------
-- A TKA exercise needs a modality the camera-era enum lacks. ADD VALUE commits with the migration and cannot be
-- used inside the same transaction, so nothing below references it; the seed script writes the exercise row.
alter type public.exercise_modality add value if not exists 'knee_flexion_extension';

-- Clinician review gate --------------------------------------------------------------------------------------
-- True when the patient exists and the caller is a platform admin, an active clinician with an active
-- care_team_link to the patient, or the clinic_admin of the patient's clinic. Unlike app.can_access_patient it
-- does not admit the patient themselves, and it requires clinicians.is_active, which can_access_patient ignores.
create or replace function app.can_review_patient(p_patient uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.patients pt where pt.id = p_patient)
    and (
      app.is_admin()
      or exists (
        select 1
        from public.care_team_links l
        join public.clinicians c on c.id = l.clinician_id
        where l.patient_id = p_patient
          and l.is_active
          and c.is_active
          and c.profile_id = auth.uid()
      )
      or exists (
        select 1
        from public.patients pt
        join public.profiles pr on pr.id = auth.uid()
        where pt.id = p_patient
          and pr.role = 'clinic_admin'
          and pr.clinic_id = pt.clinic_id
      )
    );
$$;
comment on function app.can_review_patient(uuid) is
  'Clinician review gate: admin | active clinician with an active care_team_link | the patient''s clinic_admin. Never clinic-membership equality.';

-- Post-session check-in ------------------------------------------------------------------------------------
-- One row per session, written once through submit_session_check_in and never edited. The answer set mirrors
-- Phoenix's Questionnaire: pain before/after and difficulty on 0–10, how the knee feels (required), new symptoms
-- with an exclusive "none" that is not stored (an empty array means none were reported), and a short note that
-- only exists alongside "other".
create table public.session_check_ins (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null unique references public.sessions (id) on delete cascade,
  patient_id   uuid not null references public.patients (id) on delete cascade,
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  pain_before  smallint not null check (pain_before between 0 and 10),
  pain_after   smallint not null check (pain_after between 0 and 10),
  difficulty   smallint not null check (difficulty between 0 and 10),
  knee_feels   text not null check (knee_feels in ('better', 'same', 'slightly_worse', 'much_worse')),
  symptoms     text[] not null default '{}'
               check (symptoms <@ array['swelling', 'redness', 'calf_pain', 'other']::text[]),
  other_note   text check (
                 other_note is null
                 or (char_length(other_note) between 1 and 280 and 'other' = any (symptoms))
               ),
  language     text not null check (language in ('ru', 'kk', 'en')),
  submitted_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
comment on table public.session_check_ins is
  'Patient-reported check-in after a session (pain, difficulty, knee feel, new symptoms). Written once via submit_session_check_in; no client writes. No safety triage is derived here.';
comment on column public.session_check_ins.symptoms is
  'New symptoms reported. Empty = the patient chose "none"; "none" itself is never stored.';
comment on column public.session_check_ins.language is 'UI language the answers were given in (ru | kk | en).';
create index session_check_ins_patient_idx on public.session_check_ins (patient_id, submitted_at desc);

alter table public.session_check_ins enable row level security;

-- Readable by the patient themselves (the patients row whose profile_id is auth.uid()) and by whoever the clinician
-- RPCs admit. Not app.can_access_patient: it ignores clinicians.is_active (#20), so a deactivated clinician whose
-- link was left active would read the free-text notes that clinician_session_result withholds from them.
create policy session_check_ins_select on public.session_check_ins for select to authenticated
  using (patient_id = (select app.user_patient_id()) or app.can_review_patient(patient_id));

-- Supabase's default privileges hand every new public table to anon/authenticated in full. Reads stay behind
-- RLS; writes happen only inside the SECURITY DEFINER RPC below.
revoke all on public.session_check_ins from anon, authenticated;
grant select on public.session_check_ins to authenticated;
grant all on public.session_check_ins to service_role;

create trigger audit_session_check_ins after insert or update or delete on public.session_check_ins
  for each row execute function app.audit_row();

-- Start a session from a prescription ------------------------------------------------------------------------
-- The caller must be the prescription's patient; the prescription and its program must both be active, and the
-- program must be the caller's own too (the table policies let a patient repoint their prescription's program_id,
-- and another patient's active program must not open the gate). The session carries the program, prescription
-- and exercise ids so the clinician view can resolve the dose and the exercise config without trusting anything
-- from the client except device_info (hardware descriptors).
--
-- One session per prescription is open at a time. A session of the same prescription the caller left in progress
-- (they left the flow, closed the tab, or pressed «Далее» again from a cached page) is closed as aborted, never
-- deleted: its frames stay and its summary records why it ended. Locking the prescription row serializes two
-- concurrent starts, so the second one sees and supersedes the first instead of leaving both open.
create or replace function public.start_prescribed_session(
  p_prescription uuid,
  p_device_info  jsonb default '{}'::jsonb
)
returns public.sessions
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_patient     uuid;
  v_clinic      uuid;
  v_rx          public.prescriptions;
  v_program     public.prescription_status;
  v_device_info jsonb := coalesce(p_device_info, '{}'::jsonb);
  v_session     public.sessions;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id, clinic_id into v_patient, v_clinic
  from public.patients where profile_id = v_uid;
  if v_patient is null then
    raise exception 'caller has no patient record' using errcode = '42501';
  end if;

  select * into v_rx
  from public.prescriptions
  where id = p_prescription and patient_id = v_patient
  for update;
  if v_rx.id is null then
    raise exception 'prescription not found for caller' using errcode = '42501';
  end if;
  if v_rx.status <> 'active' then
    raise exception 'prescription is not active' using errcode = '55000';
  end if;

  select status into v_program
  from public.programs
  where id = v_rx.program_id and patient_id = v_patient;
  if v_program is distinct from 'active' then
    raise exception 'program is not active' using errcode = '55000';
  end if;

  -- Hardware descriptors only (transport, device ids/names, rate readback). Bounded so a client cannot park
  -- an arbitrary document on the session row.
  if jsonb_typeof(v_device_info) <> 'object' then
    raise exception 'device_info must be a JSON object' using errcode = '22023';
  end if;
  if pg_column_size(v_device_info) > 16384 then
    raise exception 'device_info is too large' using errcode = '22023';
  end if;

  update public.sessions
     set status   = 'aborted',
         ended_at = now(),
         summary  = coalesce(summary, '{}'::jsonb) || '{"ended_by": "superseded_by_new_session"}'::jsonb
   where patient_id = v_patient
     and prescription_id = v_rx.id
     and status = 'in_progress';

  insert into public.sessions (
    patient_id, clinic_id, program_id, prescription_id, exercise_id, status, device_info, started_at
  ) values (
    v_patient, v_clinic, v_rx.program_id, v_rx.id, v_rx.exercise_id, 'in_progress', v_device_info, now()
  )
  returning * into v_session;

  return v_session;
end;
$$;
comment on function public.start_prescribed_session(uuid, jsonb) is
  'Open an in-progress session for the caller''s own active prescription in their own active program, aborting the caller''s session of that prescription still in progress. SECURITY DEFINER.';

-- Finish a prescribed session ----------------------------------------------------------------------------------
-- The heel slide path finishes here rather than through finish_training_session (0017). That RPC completes a
-- session in any state, so a stale screen (Back into a cached exercise page) could overwrite a finished session's
-- summary and move its end time, and it can write session_metrics, which this path never computes. Here only an
-- in-progress session can be finished, once: any other status raises 55000, which the client reads as "already
-- finished". The summary is the device's own record of the attempt (reps it counted, rate and battery readouts,
-- telemetry counters): a JSON object of at most 64 KB. The row is locked first, so two finishes racing each other
-- cannot both pass the status check.
create or replace function public.finish_prescribed_session(
  p_session uuid,
  p_summary jsonb default '{}'::jsonb
)
returns public.sessions
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_patient uuid;
  v_session public.sessions;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id into v_patient
  from public.patients where profile_id = v_uid;
  if v_patient is null then
    raise exception 'caller has no patient record' using errcode = '42501';
  end if;

  select * into v_session
  from public.sessions
  where id = p_session and patient_id = v_patient
  for update;
  if v_session.id is null then
    raise exception 'session not found for caller' using errcode = '42501';
  end if;
  if v_session.status <> 'in_progress' then
    raise exception 'session is %, not in progress', v_session.status using errcode = '55000';
  end if;

  if p_summary is null or jsonb_typeof(p_summary) <> 'object' then
    raise exception 'summary must be a JSON object' using errcode = '22023';
  end if;
  if pg_column_size(p_summary) > 65536 then
    raise exception 'summary is too large' using errcode = '22023';
  end if;

  update public.sessions
     set status   = 'completed',
         ended_at = now(),
         summary  = p_summary
   where id = v_session.id
   returning * into v_session;

  return v_session;
end;
$$;
comment on function public.finish_prescribed_session(uuid, jsonb) is
  'Complete the caller''s own in-progress session with its summary (JSON object, at most 64 KB); 55000 when the session is not in progress. Never writes session_metrics. SECURITY DEFINER.';

-- Telemetry flush, redefined -----------------------------------------------------------------------------------
-- Same signature, security model and idempotency as 0021: the caller writes only to their own patient's session,
-- patient_id/clinic_id come from auth.uid(), and a resent frame is a no-op on (session_id, recorded_at, seq). The
-- heel slide recorder and the camera SessionStudio flow both send through it.
--
-- New here: an ended session keeps accepting what was recorded while it was open, because rows are delivered
-- late on purpose (unsent rows wait in IndexedDB and a later page load sends them after the session finished).
-- What it no longer accepts is anything recorded after it ended, such as a stale screen recording again on a
-- finished session. For a session that is not in progress, frames with recorded_at after ended_at and events that
-- started after ended_at are skipped: not inserted, not an error, and counted in the result. A session that is not
-- in progress and has no end time accepts nothing. recorded_at is the client's receive time and ended_at the
-- server's clock, so a client clock that is off moves this cut-off by the same amount.
--
-- Returns {"frames": inserted, "events": inserted, "skipped": frames skipped, "skipped_events": events skipped}.
-- A duplicate frame counts as neither inserted nor skipped.
create or replace function public.flush_session_telemetry_batch(
  p_session uuid,
  p_frames  jsonb default '[]'::jsonb,
  p_events  jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid            uuid := auth.uid();
  v_patient        uuid;
  v_clinic         uuid;
  v_status         public.session_status;
  v_ended_at       timestamptz;
  v_open           boolean;
  v_month          date;
  v_frames         integer := 0;
  v_events         integer := 0;
  v_frames_skipped integer := 0;
  v_events_skipped integer := 0;
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
  select status, ended_at into v_status, v_ended_at
  from public.sessions where id = p_session and patient_id = v_patient;
  if v_status is null then
    raise exception 'session not found for caller' using errcode = '42501';
  end if;
  v_open := v_status = 'in_progress';

  -- ── Frames ────────────────────────────────────────────────────────────────
  -- p_frames: [{recorded_at, seq, joint_angles, keypoints, imu, quality}, …]
  if p_frames is not null and jsonb_typeof(p_frames) = 'array' and jsonb_array_length(p_frames) > 0 then
    if not v_open then
      select count(*) into v_frames_skipped
      from jsonb_array_elements(p_frames) as f
      where not coalesce((f->>'recorded_at')::timestamptz <= v_ended_at, false);
    end if;

    -- Ensure a monthly partition exists for every month among the frames that will be stored.
    for v_month in
      select distinct date_trunc('month', (f->>'recorded_at')::timestamptz)::date
      from jsonb_array_elements(p_frames) as f
      where v_open or coalesce((f->>'recorded_at')::timestamptz <= v_ended_at, false)
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
    where v_open or coalesce((f->>'recorded_at')::timestamptz <= v_ended_at, false)
    on conflict (session_id, recorded_at, seq) do nothing; -- idempotent on retry

    get diagnostics v_frames = row_count;
  end if;

  -- ── FoG episodes ──────────────────────────────────────────────────────────
  -- p_events: [{kind, started_at, ended_at, confidence, freeze_index, source}, …]
  if p_events is not null and jsonb_typeof(p_events) = 'array' and jsonb_array_length(p_events) > 0 then
    if not v_open then
      select count(*) into v_events_skipped
      from jsonb_array_elements(p_events) as e
      where not coalesce((e->>'started_at')::timestamptz <= v_ended_at, false);
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
    from jsonb_array_elements(p_events) as e
    where v_open or coalesce((e->>'started_at')::timestamptz <= v_ended_at, false);

    get diagnostics v_events = row_count;
  end if;

  return jsonb_build_object(
    'frames', v_frames,
    'events', v_events,
    'skipped', v_frames_skipped,
    'skipped_events', v_events_skipped
  );
end;
$$;

comment on function public.flush_session_telemetry_batch(uuid, jsonb, jsonb) is
  'Single-roundtrip batched telemetry flush into the caller''s own session (frames + FoG episodes, monthly partitions created on demand). Idempotent on (session_id, recorded_at, seq). Once the session is no longer in progress, rows recorded after ended_at are skipped and counted. Used by the heel slide recorder and the camera SessionStudio flow.';

-- Submit the check-in ------------------------------------------------------------------------------------------
-- Every field is validated here, not only in the form. "none" is exclusive: sent alone it means no symptoms and
-- is stripped; sent together with a symptom the answer contradicts itself and is rejected. Symptoms are stored
-- de-duplicated in a fixed order. The note is whitespace-trimmed, kept only when "other" is selected (the form
-- hides it otherwise), and empty becomes null.
--
-- Idempotent on session_id: a second submit (double click, retry after a dropped response) returns the row
-- already stored, unchanged, without re-validating the new arguments.
create or replace function public.submit_session_check_in(
  p_session     uuid,
  p_pain_before integer,
  p_pain_after  integer,
  p_difficulty  integer,
  p_knee_feels  text,
  p_symptoms    text[],
  p_other_note  text,
  p_language    text
)
returns public.session_check_ins
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_patient  uuid;
  v_clinic   uuid;
  v_status   public.session_status;
  v_symptoms text[] := coalesce(p_symptoms, '{}'::text[]);
  v_stored   text[];
  v_note     text;
  v_row      public.session_check_ins;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id, clinic_id into v_patient, v_clinic
  from public.patients where profile_id = v_uid;
  if v_patient is null then
    raise exception 'caller has no patient record' using errcode = '42501';
  end if;

  select status into v_status
  from public.sessions where id = p_session and patient_id = v_patient;
  if v_status is null then
    raise exception 'session not found for caller' using errcode = '42501';
  end if;

  select * into v_row from public.session_check_ins where session_id = p_session;
  if v_row.id is not null then
    return v_row;
  end if;

  if v_status <> 'completed' then
    raise exception 'session is not completed' using errcode = '55000';
  end if;

  if p_pain_before is null or p_pain_before not between 0 and 10 then
    raise exception 'pain_before must be an integer from 0 to 10' using errcode = '22023';
  end if;
  if p_pain_after is null or p_pain_after not between 0 and 10 then
    raise exception 'pain_after must be an integer from 0 to 10' using errcode = '22023';
  end if;
  if p_difficulty is null or p_difficulty not between 0 and 10 then
    raise exception 'difficulty must be an integer from 0 to 10' using errcode = '22023';
  end if;
  if p_knee_feels is null or p_knee_feels not in ('better', 'same', 'slightly_worse', 'much_worse') then
    raise exception 'knee_feels must be one of better, same, slightly_worse, much_worse' using errcode = '22023';
  end if;
  if p_language is null or p_language not in ('ru', 'kk', 'en') then
    raise exception 'language must be one of ru, kk, en' using errcode = '22023';
  end if;

  if array_position(v_symptoms, null) is not null
     or not (v_symptoms <@ array['none', 'swelling', 'redness', 'calf_pain', 'other']::text[]) then
    raise exception 'symptoms may only contain none, swelling, redness, calf_pain, other' using errcode = '22023';
  end if;
  if 'none' = any (v_symptoms) and exists (select 1 from unnest(v_symptoms) s where s <> 'none') then
    raise exception 'symptoms: "none" cannot be combined with a symptom' using errcode = '22023';
  end if;
  v_stored := array(
    select s from unnest(array['swelling', 'redness', 'calf_pain', 'other']::text[]) with ordinality as o (s, n)
    where s = any (v_symptoms)
    order by n
  );

  if 'other' = any (v_stored) then
    v_note := nullif(regexp_replace(coalesce(p_other_note, ''), '^\s+|\s+$', '', 'g'), '');
    if char_length(v_note) > 280 then
      raise exception 'other_note must be at most 280 characters' using errcode = '22023';
    end if;
  end if;

  insert into public.session_check_ins (
    session_id, patient_id, clinic_id, pain_before, pain_after, difficulty,
    knee_feels, symptoms, other_note, language
  ) values (
    p_session, v_patient, v_clinic, p_pain_before, p_pain_after, p_difficulty,
    p_knee_feels, v_stored, v_note, p_language
  )
  on conflict (session_id) do nothing
  returning * into v_row;

  -- Lost a race with a concurrent submit of the same session: hand back the row that won.
  if v_row.id is null then
    select * into v_row from public.session_check_ins where session_id = p_session;
  end if;

  return v_row;
end;
$$;
comment on function public.submit_session_check_in(uuid, integer, integer, integer, text, text[], text, text) is
  'Validate and store the caller''s check-in for their own completed session. Idempotent on session_id. SECURITY DEFINER.';

-- Clinician: a patient's sessions ------------------------------------------------------------------------------
-- Newest first, every status, with just enough to pick one. null when the caller may not review the patient or
-- the patient does not exist; an empty array when they simply have no sessions.
create or replace function public.clinician_patient_sessions(p_patient uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when app.can_review_patient(p_patient) then (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'started_at', s.started_at,
          'ended_at', s.ended_at,
          'status', s.status,
          'exercise_slug', e.slug::text,
          'exercise_name', e.name,
          'has_check_in', exists (select 1 from public.session_check_ins ci where ci.session_id = s.id)
        ) order by s.started_at desc, s.id
      ), '[]'::jsonb)
      from public.sessions s
      left join public.exercises e on e.id = s.exercise_id
      where s.patient_id = p_patient
    )
    else null
  end;
$$;
comment on function public.clinician_patient_sessions(uuid) is
  'A patient''s sessions (newest first) for a reviewer allowed by app.can_review_patient, else null. SECURITY DEFINER.';

-- Clinician: one session's result -----------------------------------------------------------------------------
-- The session, its exercise config and prescribed dose, the patient's name, the check-in, and the stored
-- orientation pitch per sensor role as [[t_ms, pitch_deg], …] ordered by (recorded_at, seq).
--
-- Everything per-patient is read through the session's own patient: a patient can repoint their session's
-- prescription_id through the table policy, and another patient's prescription must never show up here (it comes
-- back as null instead). The exercise is the shared catalog row and has no owner to check.
--
-- pitch is imu.euler_deg[1] exactly as the sensor reported it: a device orientation, not a joint angle. Frames
-- whose pitch is missing or not a number are left out of the series (never filled in) but still counted in
-- frame_counts, so the gap is visible. Foot frames are counted only; the heel slide path does not chart them.
create or replace function public.clinician_session_result(p_session uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_session public.sessions;
  v_result  jsonb;
begin
  select * into v_session from public.sessions where id = p_session;
  if v_session.id is null or not app.can_review_patient(v_session.patient_id) then
    return null;
  end if;

  with frames as (
    select
      f.imu ->> 'role' as role,
      f.recorded_at,
      f.seq,
      case when jsonb_typeof(f.imu -> 'euler_deg' -> 1) = 'number'
           then (f.imu -> 'euler_deg' ->> 1)::float8
      end as pitch_deg
    from public.session_frames f
    where f.session_id = v_session.id
      and f.patient_id = v_session.patient_id
  )
  select jsonb_build_object(
    'session', jsonb_build_object(
      'id', v_session.id,
      'patient_id', v_session.patient_id,
      'program_id', v_session.program_id,
      'prescription_id', v_session.prescription_id,
      'exercise_id', v_session.exercise_id,
      'status', v_session.status,
      'started_at', v_session.started_at,
      'ended_at', v_session.ended_at,
      'device_info', v_session.device_info,
      'summary', v_session.summary
    ),
    'exercise', (
      select jsonb_build_object(
        'slug', e.slug::text,
        'name', e.name,
        'scoring_rubric', e.scoring_rubric,
        'default_dose', e.default_dose
      )
      from public.exercises e where e.id = v_session.exercise_id
    ),
    'prescription', (
      select jsonb_build_object('id', rx.id, 'status', rx.status, 'dose', rx.dose)
      from public.prescriptions rx
      where rx.id = v_session.prescription_id
        and rx.patient_id = v_session.patient_id
    ),
    'patient', (
      select jsonb_build_object(
        'id', pt.id,
        'name', coalesce(nullif(pr.display_name, ''), nullif(pr.full_name, ''),
                         nullif(split_part(pr.email::text, '@', 1), ''))
      )
      from public.patients pt
      join public.profiles pr on pr.id = pt.profile_id
      where pt.id = v_session.patient_id
    ),
    'check_in', (
      select to_jsonb(ci) from public.session_check_ins ci
      where ci.session_id = v_session.id
        and ci.patient_id = v_session.patient_id
    ),
    'frames', jsonb_build_object(
      'thigh', (
        select coalesce(jsonb_agg(
          jsonb_build_array((extract(epoch from fr.recorded_at) * 1000)::float8, fr.pitch_deg)
          order by fr.recorded_at, fr.seq
        ), '[]'::jsonb)
        from frames fr where fr.role = 'thigh' and fr.pitch_deg is not null
      ),
      'shank', (
        select coalesce(jsonb_agg(
          jsonb_build_array((extract(epoch from fr.recorded_at) * 1000)::float8, fr.pitch_deg)
          order by fr.recorded_at, fr.seq
        ), '[]'::jsonb)
        from frames fr where fr.role = 'shank' and fr.pitch_deg is not null
      ),
      'foot_count', (select count(*) from frames fr where fr.role = 'foot')
    ),
    'frame_counts', jsonb_build_object(
      'thigh', (select count(*) from frames fr where fr.role = 'thigh'),
      'shank', (select count(*) from frames fr where fr.role = 'shank'),
      'foot',  (select count(*) from frames fr where fr.role = 'foot')
    )
  ) into v_result;

  return v_result;
end;
$$;
comment on function public.clinician_session_result(uuid) is
  'One session for review: session, exercise config, the session patient''s own prescription dose, patient name, check-in, stored per-role pitch series. null unless app.can_review_patient. SECURITY DEFINER.';

-- Grants ---------------------------------------------------------------------------------------------------------
-- New functions are executable by PUBLIC and, through Supabase's default privileges, by anon. Only signed-in
-- users may call the RPCs; each one then checks the caller itself. The flush was left open to PUBLIC by 0021; it
-- refused anon inside the body anyway, and now the grant says so too.
revoke execute on function app.can_review_patient(uuid) from public, anon;
grant execute on function app.can_review_patient(uuid) to authenticated, service_role;

revoke execute on function public.start_prescribed_session(uuid, jsonb) from public, anon;
revoke execute on function public.finish_prescribed_session(uuid, jsonb) from public, anon;
revoke execute on function public.flush_session_telemetry_batch(uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.submit_session_check_in(uuid, integer, integer, integer, text, text[], text, text)
  from public, anon;
revoke execute on function public.clinician_patient_sessions(uuid) from public, anon;
revoke execute on function public.clinician_session_result(uuid) from public, anon;

grant execute on function public.start_prescribed_session(uuid, jsonb) to authenticated;
grant execute on function public.finish_prescribed_session(uuid, jsonb) to authenticated;
grant execute on function public.flush_session_telemetry_batch(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.submit_session_check_in(uuid, integer, integer, integer, text, text[], text, text)
  to authenticated;
grant execute on function public.clinician_patient_sessions(uuid) to authenticated;
grant execute on function public.clinician_session_result(uuid) to authenticated;
