-- 0005_programs.sql
-- The prescription layer: a catalog of exercises/packs (reference data) plus the
-- per-patient program, prescriptions, goals, and schedule. Per-patient rows carry a
-- denormalized clinic_id so RLS isolates by tenant without extra joins.

-- Catalog: exercise packs (modality groupings) ------------------------------
create table public.exercise_packs (
  id           uuid primary key default gen_random_uuid(),
  slug         extensions.citext unique not null,
  title        text not null,
  modality     public.exercise_modality not null,
  description  text,
  evidence     jsonb not null default '[]'::jsonb,  -- citation slugs / DOIs
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.exercise_packs is 'Catalog of exercise packs (Part 5 ship order). Reference data.';

-- Catalog: exercises ---------------------------------------------------------
create table public.exercises (
  id             uuid primary key default gen_random_uuid(),
  pack_id        uuid references public.exercise_packs (id) on delete set null,
  slug           extensions.citext unique not null,
  name           text not null,
  modality       public.exercise_modality not null,
  target_joints  public.body_site[] not null default '{}',
  difficulty     public.difficulty_level not null default 'easy',
  description    text,
  instructions   text,
  safety_notes   text,
  media          jsonb not null default '{}'::jsonb,  -- explainer loop / animation refs
  scoring_rubric jsonb not null default '{}'::jsonb,  -- clinical scoring rubric
  default_dose   jsonb not null default '{}'::jsonb,  -- sets / reps / duration
  is_published   boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.exercises is 'Catalog of exercises; each maps to a validated clinical metric. Reference data.';
create index exercises_pack_idx on public.exercises (pack_id);
create index exercises_modality_idx on public.exercises (modality);
create index exercises_name_trgm_idx on public.exercises using gin (name extensions.gin_trgm_ops);

-- Per-patient program (the prescribed plan) ----------------------------------
create table public.programs (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients (id) on delete cascade,
  clinic_id   uuid not null references public.clinics (id) on delete cascade,
  title       text not null default 'Rehab program',
  status      public.prescription_status not null default 'active',
  start_date  date not null default current_date,
  end_date    date,
  created_by  uuid references public.clinicians (id) on delete set null,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.programs is 'A patient''s overall rehab plan; container for prescriptions, goals, schedule.';
create index programs_patient_idx on public.programs (patient_id);
create index programs_clinic_idx on public.programs (clinic_id);

-- Prescriptions (an exercise prescribed within a program) --------------------
create table public.prescriptions (
  id                uuid primary key default gen_random_uuid(),
  program_id        uuid not null references public.programs (id) on delete cascade,
  patient_id        uuid not null references public.patients (id) on delete cascade,
  clinic_id         uuid not null references public.clinics (id) on delete cascade,
  exercise_id       uuid not null references public.exercises (id) on delete restrict,
  difficulty        public.difficulty_level,
  dose              jsonb not null default '{}'::jsonb,
  frequency_per_week integer check (frequency_per_week between 0 and 21),
  status            public.prescription_status not null default 'active',
  prescribed_by     uuid references public.clinicians (id) on delete set null,
  clinician_note    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.prescriptions is 'A specific exercise prescribed to a patient with dose + difficulty.';
create index prescriptions_program_idx on public.prescriptions (program_id);
create index prescriptions_patient_idx on public.prescriptions (patient_id);
create index prescriptions_exercise_idx on public.prescriptions (exercise_id);

-- Goals (per joint / function) ----------------------------------------------
create table public.goals (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients (id) on delete cascade,
  clinic_id      uuid not null references public.clinics (id) on delete cascade,
  program_id     uuid references public.programs (id) on delete set null,
  joint          public.body_site,
  metric         text not null,
  target_value   numeric,
  baseline_value numeric,
  current_value  numeric,
  unit           text,
  status         public.goal_status not null default 'active',
  due_date       date,
  created_by     uuid references public.clinicians (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.goals is 'Clinical goal per joint/function with target vs current.';
create index goals_patient_idx on public.goals (patient_id);
create index goals_program_idx on public.goals (program_id);

-- Schedule (weekly calendar entries) -----------------------------------------
create table public.schedules (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.patients (id) on delete cascade,
  clinic_id        uuid not null references public.clinics (id) on delete cascade,
  program_id       uuid references public.programs (id) on delete cascade,
  prescription_id  uuid references public.prescriptions (id) on delete cascade,
  scheduled_for    timestamptz not null,
  duration_minutes integer check (duration_minutes > 0),
  recurrence_rule  text,  -- iCal RRULE
  status           text not null default 'planned'
                   check (status in ('planned', 'completed', 'missed', 'skipped')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.schedules is 'Scheduled session slots driving the weekly calendar + reminders.';
create index schedules_patient_idx on public.schedules (patient_id);
create index schedules_scheduled_for_idx on public.schedules (scheduled_for);

create trigger touch_exercise_packs before update on public.exercise_packs
  for each row execute function app.touch_updated_at();
create trigger touch_exercises before update on public.exercises
  for each row execute function app.touch_updated_at();
create trigger touch_programs before update on public.programs
  for each row execute function app.touch_updated_at();
create trigger touch_prescriptions before update on public.prescriptions
  for each row execute function app.touch_updated_at();
create trigger touch_goals before update on public.goals
  for each row execute function app.touch_updated_at();
create trigger touch_schedules before update on public.schedules
  for each row execute function app.touch_updated_at();
