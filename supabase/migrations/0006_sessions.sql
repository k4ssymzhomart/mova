-- 0006_sessions.sql
-- Session lifecycle + outcomes. session_frames is the high-volume time-series and
-- uses native declarative range partitioning by time so the schema runs on any
-- Postgres; the default partition is the Timescale create_hypertable() swap point.
-- Privacy: frames store DERIVED keypoints/metrics only — raw video never leaves the client.

-- Sessions -------------------------------------------------------------------
create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients (id) on delete cascade,
  clinic_id       uuid not null references public.clinics (id) on delete cascade,
  program_id      uuid references public.programs (id) on delete set null,
  prescription_id uuid references public.prescriptions (id) on delete set null,
  exercise_id     uuid references public.exercises (id) on delete set null,
  status          public.session_status not null default 'in_progress',
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  device_info     jsonb not null default '{}'::jsonb,  -- camera + IMU descriptors (no PHI)
  summary         jsonb not null default '{}'::jsonb,
  reviewed_by     uuid references public.clinicians (id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
comment on table public.sessions is 'One rehab session; parent of frames, metrics, FoG events, ROM measurements.';
create index sessions_patient_idx on public.sessions (patient_id, started_at desc);
create index sessions_clinic_idx on public.sessions (clinic_id);
create index sessions_status_idx on public.sessions (status);

-- Per-session aggregate metrics (1:1) ----------------------------------------
create table public.session_metrics (
  session_id         uuid primary key references public.sessions (id) on delete cascade,
  patient_id         uuid not null references public.patients (id) on delete cascade,
  clinic_id          uuid not null references public.clinics (id) on delete cascade,
  reps               integer,
  rom_max            numeric,
  rom_mean           numeric,
  smoothness         numeric,   -- jerk-derived
  symmetry           numeric,
  quality_score      numeric,
  adherence          numeric,
  fog_risk           numeric,
  compensation_flags jsonb not null default '{}'::jsonb,
  extras             jsonb not null default '{}'::jsonb,
  computed_at        timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.session_metrics is 'Aggregate clinical metrics per session (ROM, smoothness, symmetry, FoG risk, adherence).';
create index session_metrics_patient_idx on public.session_metrics (patient_id);

-- Per-frame time-series (partitioned by time) --------------------------------
create table public.session_frames (
  session_id   uuid not null references public.sessions (id) on delete cascade,
  patient_id   uuid not null references public.patients (id) on delete cascade,
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  recorded_at  timestamptz not null,
  seq          integer not null,
  joint_angles jsonb,   -- {joint: deg}
  keypoints    jsonb,   -- derived pose landmarks ONLY (no raw video)
  imu          jsonb,   -- fused / raw IMU features
  quality      numeric, -- per-frame confidence
  created_at   timestamptz not null default now(),
  primary key (session_id, recorded_at, seq)
) partition by range (recorded_at);
comment on table public.session_frames is 'High-volume per-frame kinematics, range-partitioned by recorded_at.';
create index session_frames_patient_time_idx on public.session_frames (patient_id, recorded_at desc);

-- Default partition catches any range; monthly partitions are added on demand.
create table public.session_frames_default partition of public.session_frames default;

-- Create a monthly partition if it does not yet exist.
create or replace function app.ensure_session_frames_partition(p_month date)
returns void
language plpgsql
as $$
declare
  start_date date := date_trunc('month', p_month)::date;
  end_date   date := (date_trunc('month', p_month) + interval '1 month')::date;
  part_name  text := format('session_frames_%s', to_char(start_date, 'YYYY_MM'));
begin
  if not exists (select 1 from pg_class where relname = part_name) then
    execute format(
      'create table public.%I partition of public.session_frames for values from (%L) to (%L)',
      part_name, start_date, end_date
    );
  end if;
end;
$$;
comment on function app.ensure_session_frames_partition(date) is 'Create the monthly session_frames partition covering p_month if absent.';

select app.ensure_session_frames_partition(current_date);
select app.ensure_session_frames_partition((current_date + interval '1 month')::date);

-- Freezing-of-gait events (window-level model output + smoothed episodes) ----
create table public.fog_events (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions (id) on delete cascade,
  patient_id   uuid not null references public.patients (id) on delete cascade,
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  kind         public.fog_event_kind not null default 'episode',
  started_at   timestamptz not null,
  ended_at     timestamptz,
  confidence   numeric,
  freeze_index numeric,  -- Bachlin Freeze Index
  source       text,     -- model id, e.g. 'mock-bachlin-freeze-index' or a registry version
  created_at   timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
comment on table public.fog_events is 'Detected freezing-of-gait windows/episodes; mirrors the inference service contract.';
create index fog_events_session_idx on public.fog_events (session_id, started_at desc);
create index fog_events_patient_idx on public.fog_events (patient_id, started_at desc);

-- ROM measurements (per joint over time) -------------------------------------
create table public.rom_measurements (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid references public.sessions (id) on delete cascade,
  patient_id  uuid not null references public.patients (id) on delete cascade,
  clinic_id   uuid not null references public.clinics (id) on delete cascade,
  joint       public.body_site not null,
  measured_at timestamptz not null default now(),
  angle_deg   numeric not null,
  direction   text,  -- flexion / extension / abduction / ...
  source      text not null default 'fused' check (source in ('cv', 'imu', 'fused')),
  created_at  timestamptz not null default now()
);
comment on table public.rom_measurements is 'Per-joint range-of-motion measurements feeding the Progress trends.';
create index rom_measurements_patient_joint_idx on public.rom_measurements (patient_id, joint, measured_at desc);
create index rom_measurements_session_idx on public.rom_measurements (session_id);

create trigger touch_sessions before update on public.sessions
  for each row execute function app.touch_updated_at();
create trigger touch_session_metrics before update on public.session_metrics
  for each row execute function app.touch_updated_at();
