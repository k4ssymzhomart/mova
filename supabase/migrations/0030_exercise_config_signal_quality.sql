-- 0030_exercise_config_signal_quality.sql
-- Phase B, part 2: per-exercise scoring configuration (NTZ §11.1, Appendix A) plus
-- Calibration and SignalQuality as first-class stored entities (NTZ IMU-07 — signal
-- quality must gate trust in a score, never be mixed into it).

create type public.quantifiability_class as enum ('full', 'partial', 'completion_only');
create type public.target_type as enum ('at_least', 'at_most', 'in_range', 'no_target');

-- Append-only guard for entities that must never be mutated once written (rescoring /
-- recalibration always appends a new row). Distinct from app.freeze_columns(), which
-- allows a row to be updated but blocks specific columns from changing -- this blocks
-- ALL column changes on UPDATE and blocks DELETE entirely.
create or replace function app.prevent_row_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or app.is_admin() then
    return coalesce(new, old);
  end if;
  raise exception '% rows are append-only (% not permitted)', tg_table_name, lower(tg_op)
    using errcode = 'check_violation';
end;
$$;
comment on function app.prevent_row_change() is
  'BEFORE UPDATE OR DELETE trigger: reject all changes unless caller is admin or a trusted (auth.uid() null) context.';

-- Versioned per-exercise scoring configuration. quantifiability_class governs whether
-- a quality score may legitimately be shown for this exercise at all (e.g. IMU cannot
-- measure muscle force for Quad Set, so that exercise must be 'completion_only').
create table public.exercise_configs (
  id                        uuid primary key default gen_random_uuid(),
  exercise_id               uuid not null references public.exercises (id) on delete cascade,
  version                   integer not null default 1,
  quantifiability_class     public.quantifiability_class not null default 'partial',
  target_type               public.target_type not null default 'no_target',
  target_metric             text,
  target_value              numeric,
  min_valid_excursion       numeric,
  tempo_range               jsonb,
  hold_target               numeric,
  correctness_weights       jsonb not null default '{}'::jsonb,
  target_score_bands        jsonb not null default '{}'::jsonb,
  signal_confidence_min     numeric,
  feedback_rules            jsonb not null default '[]'::jsonb,
  realtime_metric_whitelist jsonb not null default '[]'::jsonb,
  created_at                timestamptz not null default now(),
  unique (exercise_id, version)
);
comment on table public.exercise_configs is
  'Versioned per-exercise scoring configuration (NTZ §11.1). Reference data, admin-authored.';
create index exercise_configs_exercise_idx on public.exercise_configs (exercise_id);

alter table public.exercise_configs enable row level security;
create policy exercise_configs_select on public.exercise_configs for select to authenticated using (true);
create policy exercise_configs_write on public.exercise_configs for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
grant select, insert, update, delete on public.exercise_configs to authenticated;
grant all on public.exercise_configs to service_role;
create trigger audit_exercise_configs after insert or update or delete on public.exercise_configs
  for each row execute function app.audit_row();

-- Per-session sensor calibration record: parameters + quality flag + algorithm
-- version. Written exclusively by a future SECURITY DEFINER RPC once the calibration
-- pipeline exists (mirrors the 0025 RPC-only-write pattern) -- no client write grant.
create table public.calibrations (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.sessions (id) on delete cascade,
  patient_id        uuid not null references public.patients (id) on delete cascade,
  clinic_id         uuid not null references public.clinics (id) on delete cascade,
  parameters        jsonb not null default '{}'::jsonb,
  quality_flag      text not null default 'unknown' check (quality_flag in ('good', 'degraded', 'invalid', 'unknown')),
  algorithm_version text not null,
  created_at        timestamptz not null default now()
);
comment on table public.calibrations is
  'Per-session calibration: parameters + quality flag + algorithm version. Append-only.';
create index calibrations_session_idx on public.calibrations (session_id);
create index calibrations_patient_idx on public.calibrations (patient_id);

alter table public.calibrations enable row level security;
create policy calibrations_select on public.calibrations for select to authenticated using (app.can_access_patient(patient_id));
grant select on public.calibrations to authenticated;
grant all on public.calibrations to service_role;
create trigger prevent_calibrations_change before update or delete on public.calibrations
  for each row execute function app.prevent_row_change();

-- First-class signal-quality record per session, kept separate from any clinical
-- score (NTZ IMU-07: signal quality gates trust in a score, never mixed into it).
create table public.signal_quality (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.sessions (id) on delete cascade,
  patient_id        uuid not null references public.patients (id) on delete cascade,
  clinic_id         uuid not null references public.clinics (id) on delete cascade,
  calibration_id    uuid references public.calibrations (id) on delete set null,
  algorithm_version text not null,
  result            jsonb not null default '{}'::jsonb,  -- sample rate, sync skew, clipping, confidence
  is_trustworthy    boolean not null default false,
  created_at        timestamptz not null default now()
);
comment on table public.signal_quality is
  'Per-session signal-quality evaluation; gates whether a score can be trusted. Append-only.';
create index signal_quality_session_idx on public.signal_quality (session_id);
create index signal_quality_patient_idx on public.signal_quality (patient_id);

alter table public.signal_quality enable row level security;
create policy signal_quality_select on public.signal_quality for select to authenticated using (app.can_access_patient(patient_id));
grant select on public.signal_quality to authenticated;
grant all on public.signal_quality to service_role;
create trigger prevent_signal_quality_change before update or delete on public.signal_quality
  for each row execute function app.prevent_row_change();
