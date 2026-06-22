-- 0007_gamification.sql
-- Engagement ecosystem (Part 4). achievement_defs is the catalog; achievements is the
-- per-patient earned record; xp_ledger is append-only points; streaks is 1:1 per patient.

-- Badge catalog (reference data) ---------------------------------------------
create table public.achievement_defs (
  code        extensions.citext primary key,
  title       text not null,
  description text,
  icon        text,
  criteria    jsonb not null default '{}'::jsonb,
  xp_reward   integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.achievement_defs is 'Catalog of badge definitions. Reference data.';

-- Earned achievements (per patient) ------------------------------------------
create table public.achievements (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  clinic_id  uuid not null references public.clinics (id) on delete cascade,
  def_code   extensions.citext not null references public.achievement_defs (code) on delete cascade,
  earned_at  timestamptz not null default now(),
  progress   numeric not null default 1.0,
  created_at timestamptz not null default now(),
  unique (patient_id, def_code)
);
comment on table public.achievements is 'Badges a patient has earned (or is progressing toward).';
create index achievements_patient_idx on public.achievements (patient_id);

-- XP ledger (append-only) ----------------------------------------------------
create table public.xp_ledger (
  id         uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  clinic_id  uuid not null references public.clinics (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  delta      integer not null,
  reason     text,
  created_at timestamptz not null default now()
);
comment on table public.xp_ledger is 'Append-only XP events; level/total derived by aggregation.';
create index xp_ledger_patient_idx on public.xp_ledger (patient_id, created_at desc);

-- Streaks (1:1 per patient) --------------------------------------------------
create table public.streaks (
  patient_id        uuid primary key references public.patients (id) on delete cascade,
  clinic_id         uuid not null references public.clinics (id) on delete cascade,
  current_streak    integer not null default 0,
  longest_streak    integer not null default 0,
  last_active_date  date,
  freezes_remaining integer not null default 0,  -- gentle-recovery streak freezes
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.streaks is 'Daily streak state per patient, including streak-freeze budget.';

create trigger touch_achievement_defs before update on public.achievement_defs
  for each row execute function app.touch_updated_at();
create trigger touch_streaks before update on public.streaks
  for each row execute function app.touch_updated_at();
