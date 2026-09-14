-- 0031_algorithm_score_prompt_versioning.sql
-- Phase B, part 3: full lineage traceability (NTZ §17.3, AC-10) -- every derived
-- result must carry the algorithm/score/prompt version that produced it, and rescoring
-- must append a new row rather than mutate the old one. model_registry (0009) is close
-- but is a model-artifact registry, not this per-result versioning contract.

create table public.algorithm_versions (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  code_reference text,
  parameters     jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (name, code_reference)
);
comment on table public.algorithm_versions is 'Registry of algorithm versions a derived result can be attributed to. Reference data.';

create table public.score_versions (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  formula    jsonb not null,
  created_at timestamptz not null default now(),
  unique (name)
);
comment on table public.score_versions is 'Registry of clinical scoring formula versions. Reference data.';

create table public.prompt_versions (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  prompt_template text not null,
  model_id        uuid references public.model_registry (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (name)
);
comment on table public.prompt_versions is 'Registry of AI-narrative prompt versions (AC-10: every AI output must be attributable to one). Reference data.';

-- Reference/registry tables: readable by all authenticated, writable by admin only
-- (mirrors the exercises_write / model_registry_write pattern in 0012).
alter table public.algorithm_versions enable row level security;
create policy algorithm_versions_select on public.algorithm_versions for select to authenticated using (true);
create policy algorithm_versions_write on public.algorithm_versions for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
grant select, insert, update, delete on public.algorithm_versions to authenticated;
grant all on public.algorithm_versions to service_role;

alter table public.score_versions enable row level security;
create policy score_versions_select on public.score_versions for select to authenticated using (true);
create policy score_versions_write on public.score_versions for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
grant select, insert, update, delete on public.score_versions to authenticated;
grant all on public.score_versions to service_role;

alter table public.prompt_versions enable row level security;
create policy prompt_versions_select on public.prompt_versions for select to authenticated using (true);
create policy prompt_versions_write on public.prompt_versions for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
grant select, insert, update, delete on public.prompt_versions to authenticated;
grant all on public.prompt_versions to service_role;

-- Derived metrics: one row per algorithm run over a session, traceable to the
-- calibration + algorithm version that produced it. Append-only.
create table public.derived_metrics (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references public.sessions (id) on delete cascade,
  patient_id            uuid not null references public.patients (id) on delete cascade,
  clinic_id             uuid not null references public.clinics (id) on delete cascade,
  calibration_id        uuid references public.calibrations (id) on delete set null,
  algorithm_version_id  uuid not null references public.algorithm_versions (id),
  metrics               jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now()
);
comment on table public.derived_metrics is 'Algorithm-derived metrics for a session, traceable to calibration + algorithm version. Append-only.';
create index derived_metrics_session_idx on public.derived_metrics (session_id);
create index derived_metrics_patient_idx on public.derived_metrics (patient_id);

alter table public.derived_metrics enable row level security;
create policy derived_metrics_select on public.derived_metrics for select to authenticated using (app.can_access_patient(patient_id));
grant select on public.derived_metrics to authenticated;
grant all on public.derived_metrics to service_role;
create trigger prevent_derived_metrics_change before update or delete on public.derived_metrics
  for each row execute function app.prevent_row_change();

-- Exercise scores: one row per scored attempt, fk chain session -> calibration ->
-- algorithm_version -> score_version. Rescoring inserts a NEW row referencing the
-- superseded one via recalculated_from_score_id -- it never mutates the old row.
create table public.exercise_scores (
  id                          uuid primary key default gen_random_uuid(),
  session_id                  uuid not null references public.sessions (id) on delete cascade,
  patient_id                  uuid not null references public.patients (id) on delete cascade,
  clinic_id                   uuid not null references public.clinics (id) on delete cascade,
  score_version_id            uuid not null references public.score_versions (id),
  algorithm_version_id        uuid not null references public.algorithm_versions (id),
  calibration_id              uuid references public.calibrations (id),
  value                       numeric,
  calculation_reason          text,
  recalculated_from_score_id  uuid references public.exercise_scores (id),
  created_at                  timestamptz not null default now()
);
comment on table public.exercise_scores is
  'A scored attempt, fully traceable to the score/algorithm version and calibration that produced it. '
  'Append-only; rescoring appends a new row via recalculated_from_score_id.';
create index exercise_scores_session_idx on public.exercise_scores (session_id);
create index exercise_scores_patient_idx on public.exercise_scores (patient_id);

alter table public.exercise_scores enable row level security;
create policy exercise_scores_select on public.exercise_scores for select to authenticated using (app.can_access_patient(patient_id));
grant select on public.exercise_scores to authenticated;
grant all on public.exercise_scores to service_role;
create trigger prevent_exercise_scores_change before update or delete on public.exercise_scores
  for each row execute function app.prevent_row_change();
