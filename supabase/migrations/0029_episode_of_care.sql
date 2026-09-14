-- 0029_episode_of_care.sql
-- Phase B, part 1: the TKA/episode-of-care domain (NTZ §4.3, §21.2 AC-01). Additive
-- only. Every new table follows the existing convention: uuid PK, denormalized
-- clinic_id/patient_id, RLS enabled in this same migration, explicit grants (the
-- 0012 blanket grant only ever applied to tables that existed at that time -- 0016
-- and 0022 both had to add their own explicit grants, and so does this migration),
-- audit trigger since this is PHI/clinically relevant.

create type public.weight_bearing_status as enum (
  'non_wb', 'toe_touch', 'partial', 'wb_as_tolerated', 'full'
);
create type public.episode_status as enum ('active', 'discharged');

create table public.episodes_of_care (
  id                     uuid primary key default gen_random_uuid(),
  patient_id             uuid not null references public.patients (id) on delete cascade,
  clinic_id              uuid not null references public.clinics (id) on delete cascade,
  operated_side          text not null check (operated_side in ('left', 'right', 'bilateral')),
  surgery_date           date,
  operation_type         text not null default 'primary_tka'
                         check (operation_type in ('primary_tka', 'revision_tka', 'partial_tka', 'other')),
  surgeon_name           text,
  weight_bearing_status  public.weight_bearing_status not null default 'wb_as_tolerated',
  precautions            jsonb not null default '[]'::jsonb,  -- structured list; free-text fallback per item
  next_visit_date        date,
  status                 public.episode_status not null default 'active',
  created_by             uuid references public.clinicians (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
comment on table public.episodes_of_care is
  'TKA episode of care: surgery, weight-bearing status, precautions, next visit. POD (post-op day) is '
  'derived as (current_date - surgery_date), not stored.';
create index episodes_of_care_patient_idx on public.episodes_of_care (patient_id);
create index episodes_of_care_clinic_idx on public.episodes_of_care (clinic_id);

alter table public.episodes_of_care enable row level security;
create policy episodes_of_care_rw on public.episodes_of_care for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));
grant select, insert, update, delete on public.episodes_of_care to authenticated;
grant all on public.episodes_of_care to service_role;

create trigger touch_episodes_of_care before update on public.episodes_of_care
  for each row execute function app.touch_updated_at();
create trigger audit_episodes_of_care after insert or update or delete on public.episodes_of_care
  for each row execute function app.audit_row();

-- NOTE: a new enum value cannot be used in the same transaction it is added in
-- (Postgres restriction; migration files run as one transaction), so any exercise
-- seeded with modality = 'knee_flexion_extension' must go in a later migration or
-- seed.sql, never in this one.
alter type public.exercise_modality add value if not exists 'knee_flexion_extension';
