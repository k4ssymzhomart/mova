-- 0041_session_scores.sql
-- Wires services/frontend/src/lib/scoring's Heel Slide scoring engine to a persisted row, so a computed
-- score survives a reload and the clinician side (which never recomputes) has something to read.
--
-- Scope: Heel Slide only, per the plan this ships against. The other seven exercises' ExerciseConfigs stay
-- code-complete without a session UI to score, so nothing here is exercise-specific beyond exercise_slug.
--
-- Numbered above #34's 0034-0036 range and the unapplied #37-0040. Nothing here depends on 0038's
-- 'heel_slide' exercise row (see the known slug mismatch note in lib/scoring/heelSlideStoredScore.ts):
-- exercise_slug is whatever the caller's own ExerciseSlug says, not a foreign key to public.exercises.
--
-- One row per session, written once by store_session_score and never edited — same idempotent-write shape
-- as 0034's submit_session_check_in. Computation happens in application code (lib/scoring), not in SQL: the
-- formulas already live in TypeScript, tested against the spec's own worked examples, and porting them into
-- plpgsql would create a second copy to keep in sync. This RPC only validates and stores what it is given.
--
-- score_cap_reason stays null for every row this migration's RPC can produce: the spec's own second worked
-- example (docx §15) implies a further cap beyond the canonical Execution Effectiveness formula but gives no
-- formula for it, and lib/scoring/executionScore.ts deliberately does not guess one. The column exists so a
-- future migration can fill it in once the clinical spec owner specifies the rule, without a schema change.
--
-- Honesty: nothing here computes a knee angle. reps carries the same RepResult[] the patient's summary and
-- the clinician's session view render, all of it in the same relative, uncalibrated proxy degrees
-- lib/scoring/types.ts already documents (calibration to an anatomical angle is issue #17, unresolved).

create table public.session_scores (
  session_id               uuid primary key references public.sessions (id) on delete cascade,
  patient_id               uuid not null references public.patients (id) on delete cascade,
  clinic_id                uuid not null references public.clinics (id) on delete cascade,
  exercise_slug            text not null,
  -- Bumped in lib/scoring/heelSlideStoredScore.ts whenever the formulas, or how a rep becomes a RepResult,
  -- change in a way that would score an identical session differently (NTZ AC-10).
  algorithm_version        text not null,
  -- Which revision of docs/PHOENIX_8_Exercises_Targets this row was scored against.
  score_version             text not null,
  -- { frozen: boolean, frozen_reasons: string[] } — whether scoring was ever gated off by signal quality.
  signal_confidence         jsonb not null default '{}'::jsonb,
  correctness_score         numeric not null check (correctness_score between 0 and 100),
  volume_score              numeric not null check (volume_score between 0 and 100),
  target_score              numeric not null check (target_score between 0 and 100),
  execution_effectiveness   numeric not null check (execution_effectiveness between 0 and 100),
  target_reached_count      integer not null check (target_reached_count >= 0),
  valid_reps                integer not null check (valid_reps >= 0),
  prescribed_reps           integer not null check (prescribed_reps >= 0),
  rom_max_deg               numeric,
  rom_mean_deg              numeric,
  frozen                    boolean not null default false,
  frozen_reasons            text[] not null default '{}',
  -- Null until a real cap rule is specified; see the header. Never invented by this RPC.
  score_cap_reason          text,
  -- RepResult[] (lib/scoring/types.ts), for the clinician's "click to expand" detail. Provisional/uncalibrated
  -- degrees, same as everywhere else this proxy reaches the UI.
  reps                      jsonb not null default '[]'::jsonb,
  computed_at               timestamptz not null default now(),
  created_at                timestamptz not null default now()
);
comment on table public.session_scores is
  'One row per scored session: lib/scoring''s SessionResult, computed once from the authoritative stored session_frames and never edited. Provisional/uncalibrated angles (issue #17). score_cap_reason stays null — see docs/PHOENIX_8_Exercises_Targets (1).docx §15 and this file''s header.';
comment on column public.session_scores.score_cap_reason is
  'Null on every row store_session_score can currently produce. Reserved for the still-unspecified §15 cap.';
create index session_scores_patient_idx on public.session_scores (patient_id);

alter table public.session_scores enable row level security;

-- Same reviewer set as session_check_ins (0034): the patient themselves, and whoever app.can_review_patient
-- admits. Not app.can_access_patient alone: it ignores clinicians.is_active (#20), same reasoning as 0034.
create policy session_scores_select on public.session_scores for select to authenticated
  using (app.can_access_patient(patient_id) or app.can_review_patient(patient_id));

revoke all on public.session_scores from anon, authenticated;
grant select on public.session_scores to authenticated;
grant all on public.session_scores to service_role;

create trigger audit_session_scores after insert or update or delete on public.session_scores
  for each row execute function app.audit_row();

-- Store a computed score ------------------------------------------------------------------------------------
-- The caller's own patient record and their own completed session only; idempotent on session_id (a second
-- call, from a reload or a retried request, returns the row already stored without re-validating p_score).
-- Field-by-field validation happens through the table's own check constraints and not-null columns: a
-- malformed payload fails with a clear constraint violation rather than storing a partial row.
create or replace function public.store_session_score(
  p_session uuid,
  p_score   jsonb
)
returns public.session_scores
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_patient uuid;
  v_session public.sessions;
  v_row     public.session_scores;
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
  where id = p_session and patient_id = v_patient;
  if v_session.id is null then
    raise exception 'session not found for caller' using errcode = '42501';
  end if;

  select * into v_row from public.session_scores where session_id = p_session;
  if v_row.session_id is not null then
    return v_row;
  end if;

  if v_session.status <> 'completed' then
    raise exception 'session is not completed' using errcode = '55000';
  end if;

  if p_score is null or jsonb_typeof(p_score) <> 'object' then
    raise exception 'score must be a JSON object' using errcode = '22023';
  end if;
  if pg_column_size(p_score) > 65536 then
    raise exception 'score is too large' using errcode = '22023';
  end if;
  if p_score->>'exercise_slug' is null or p_score->>'algorithm_version' is null or p_score->>'score_version' is null then
    raise exception 'exercise_slug, algorithm_version and score_version are required' using errcode = '22023';
  end if;

  insert into public.session_scores (
    session_id, patient_id, clinic_id, exercise_slug, algorithm_version, score_version,
    signal_confidence, correctness_score, volume_score, target_score, execution_effectiveness,
    target_reached_count, valid_reps, prescribed_reps, rom_max_deg, rom_mean_deg,
    frozen, frozen_reasons, score_cap_reason, reps
  ) values (
    p_session, v_patient, v_session.clinic_id,
    p_score->>'exercise_slug',
    p_score->>'algorithm_version',
    p_score->>'score_version',
    coalesce(p_score->'signal_confidence', '{}'::jsonb),
    (p_score->>'correctness_score')::numeric,
    (p_score->>'volume_score')::numeric,
    (p_score->>'target_score')::numeric,
    (p_score->>'execution_effectiveness')::numeric,
    (p_score->>'target_reached_count')::integer,
    (p_score->>'valid_reps')::integer,
    (p_score->>'prescribed_reps')::integer,
    (p_score->>'rom_max_deg')::numeric,
    (p_score->>'rom_mean_deg')::numeric,
    coalesce((p_score->>'frozen')::boolean, false),
    coalesce(
      (select array_agg(reason) from jsonb_array_elements_text(coalesce(p_score->'frozen_reasons', '[]'::jsonb)) as reason),
      '{}'::text[]
    ),
    p_score->>'score_cap_reason',
    coalesce(p_score->'reps', '[]'::jsonb)
  )
  on conflict (session_id) do nothing
  returning * into v_row;

  -- Lost a race with a concurrent store of the same session: hand back the row that won.
  if v_row.session_id is null then
    select * into v_row from public.session_scores where session_id = p_session;
  end if;

  return v_row;
end;
$$;
comment on function public.store_session_score(uuid, jsonb) is
  'Validate and store the caller''s computed score for their own completed session. Idempotent on session_id; never overwrites. SECURITY DEFINER.';

revoke execute on function public.store_session_score(uuid, jsonb) from public, anon;
grant execute on function public.store_session_score(uuid, jsonb) to authenticated;
