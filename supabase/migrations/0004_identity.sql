-- 0004_identity.sql
-- Tenancy + identity core. `clinics` is the tenant; `profiles` extends auth.users 1:1;
-- `clinicians` and `patients` are role-specific records; `care_team_links` is the
-- clinician<->patient assignment that the clinician RLS policies key off.

-- Tenant ---------------------------------------------------------------------
create table public.clinics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        extensions.citext unique,
  timezone    text not null default 'UTC',
  settings    jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.clinics is 'Tenant boundary. Every clinical row is clinic-scoped for RLS isolation.';

-- App-level identity (1:1 with auth.users) -----------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         public.app_role not null default 'patient',
  clinic_id    uuid references public.clinics (id) on delete set null,
  email        extensions.citext,
  full_name    text,
  display_name text,
  avatar_url   text,
  locale       text not null default 'en' check (locale in ('en', 'ru', 'kk')),
  timezone     text not null default 'UTC',
  preferences  jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.profiles is 'Per-user app identity + role; provisioned from auth.users by the handle_new_user trigger.';
comment on column public.profiles.role is 'Authoritative app role: patient | clinician | clinic_admin | admin.';
create index profiles_clinic_idx on public.profiles (clinic_id);
create index profiles_role_idx on public.profiles (role);

-- Condition catalog (reference data) -----------------------------------------
create table public.conditions (
  id               uuid primary key default gen_random_uuid(),
  slug             extensions.citext unique not null,
  name             text not null,
  description      text,
  default_modality public.exercise_modality,
  icd10            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.conditions is 'Catalog of rehab conditions (stroke, Parkinson''s, ACL post-op, ...). Reference data.';

-- Clinician record -----------------------------------------------------------
create table public.clinicians (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null unique references public.profiles (id) on delete cascade,
  clinic_id      uuid not null references public.clinics (id) on delete cascade,
  title          text,
  license_number text,
  specialties    text[] not null default '{}',
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.clinicians is 'Clinician extension of a profile, bound to one clinic.';
create index clinicians_clinic_idx on public.clinicians (clinic_id);

-- Patient record -------------------------------------------------------------
create table public.patients (
  id                   uuid primary key default gen_random_uuid(),
  profile_id           uuid not null unique references public.profiles (id) on delete cascade,
  clinic_id            uuid not null references public.clinics (id) on delete cascade,
  mrn                  text,
  date_of_birth        date,
  affected_side        text check (affected_side in ('left', 'right', 'bilateral', 'none')),
  primary_condition_id uuid references public.conditions (id) on delete set null,
  enrollment_status    text not null default 'active'
                       check (enrollment_status in ('active', 'paused', 'discharged')),
  baseline             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (clinic_id, mrn)
);
comment on table public.patients is 'Patient extension of a profile, bound to one clinic. baseline holds intake ROM seed.';
create index patients_clinic_idx on public.patients (clinic_id);
create index patients_condition_idx on public.patients (primary_condition_id);

-- Clinician <-> patient assignment (M:N within a clinic) ----------------------
create table public.care_team_links (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  clinician_id uuid not null references public.clinicians (id) on delete cascade,
  patient_id   uuid not null references public.patients (id) on delete cascade,
  relationship public.care_relationship not null default 'primary',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (clinician_id, patient_id)
);
comment on table public.care_team_links is 'Authorizes a clinician to access a patient. The hinge of clinician RLS.';
create index care_team_links_patient_idx on public.care_team_links (patient_id);
create index care_team_links_clinician_idx on public.care_team_links (clinician_id);
create index care_team_links_clinic_idx on public.care_team_links (clinic_id);

-- updated_at triggers
create trigger touch_clinics before update on public.clinics
  for each row execute function app.touch_updated_at();
create trigger touch_profiles before update on public.profiles
  for each row execute function app.touch_updated_at();
create trigger touch_conditions before update on public.conditions
  for each row execute function app.touch_updated_at();
create trigger touch_clinicians before update on public.clinicians
  for each row execute function app.touch_updated_at();
create trigger touch_patients before update on public.patients
  for each row execute function app.touch_updated_at();
create trigger touch_care_team_links before update on public.care_team_links
  for each row execute function app.touch_updated_at();
