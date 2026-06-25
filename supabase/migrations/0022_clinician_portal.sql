-- 0022_clinician_portal.sql
-- Real-data clinician portal. The /clinician surface used to read a hard-coded mock roster; this wires
-- it to the live tables (profiles + patients + sessions + session_metrics + fog_events) through three
-- SECURITY DEFINER RPCs that are strictly scoped to the CALLER'S clinic (app.user_clinic_id). For the
-- shared self-serve tenant ("Mova Personal", 0000…00a1) every self-serve patient is in that one clinic,
-- so a signed-in member sees the real caseload; a seeded clinic stays isolated to its own patients.
--
-- Prescriptions edited in the portal persist to a purpose-built care_plan_overrides table (the portal's
-- prescription model is program-level tuning — pack / weekly dose / cadence / difficulty / note — which
-- is a different granularity from the exercise-centric public.prescriptions rows), written via RPC.

-- Portal prescription tuning, one row per patient ----------------------------
create table if not exists public.care_plan_overrides (
  patient_id           uuid primary key references public.patients (id) on delete cascade,
  clinic_id            uuid not null references public.clinics (id) on delete cascade,
  pack                 text not null default 'reaching' check (pack in ('reaching', 'gait')),
  weekly_dose_sessions integer not null default 5 check (weekly_dose_sessions between 0 and 21),
  target_cadence_spm   integer not null default 67 check (target_cadence_spm between 20 and 200),
  difficulty           numeric not null default 0.5 check (difficulty between 0 and 1),
  note                 text not null default '',
  updated_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.care_plan_overrides is
  'Clinician-authored program tuning per patient (portal prescription). Written via clinic_save_care_plan.';

alter table public.care_plan_overrides enable row level security;

-- Reads follow the standard patient gate (the patient, a linked clinician, a clinic_admin/admin) or any
-- member of the same clinic. Writes go exclusively through the SECURITY DEFINER RPC below.
drop policy if exists care_plan_overrides_read on public.care_plan_overrides;
create policy care_plan_overrides_read on public.care_plan_overrides
  for select using (app.can_access_patient(patient_id) or app.is_clinic_member(clinic_id));

drop trigger if exists touch_care_plan_overrides on public.care_plan_overrides;
create trigger touch_care_plan_overrides before update on public.care_plan_overrides
  for each row execute function app.touch_updated_at();

-- Internal: assemble one patient's full portal card as jsonb (real sessions + metrics + override). Not
-- exposed directly; only the scoped public RPCs below call it, so it carries no auth check of its own.
create or replace function app.clinic_patient_json(p_patient uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'patient_id', p.id,
    'profile_id', p.profile_id,
    'name', coalesce(nullif(pr.display_name, ''), nullif(pr.full_name, ''),
                     split_part(pr.email::text, '@', 1), 'Patient'),
    'email', pr.email::text,
    'mrn', p.mrn,
    'date_of_birth', p.date_of_birth,
    'affected_side', p.affected_side,
    'enrollment_status', p.enrollment_status,
    'baseline', p.baseline,
    'condition_slug', c.slug::text,
    'last_session_at', (
      select max(s.started_at) from public.sessions s
      where s.patient_id = p.id and s.status = 'completed'
    ),
    'fog_count', (select count(*) from public.fog_events fe where fe.patient_id = p.id),
    'care_plan', (select to_jsonb(o) from public.care_plan_overrides o where o.patient_id = p.id),
    'sessions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'started_at', s.started_at,
          'ended_at', s.ended_at,
          'summary', s.summary,
          'metrics', (select to_jsonb(m) from public.session_metrics m where m.session_id = s.id)
        ) order by s.started_at
      ), '[]'::jsonb)
      from public.sessions s
      where s.patient_id = p.id and s.status = 'completed'
    )
  )
  from public.patients p
  join public.profiles pr on pr.id = p.profile_id
  left join public.conditions c on c.id = p.primary_condition_id
  where p.id = p_patient;
$$;

-- Caseload: every patient in the caller's clinic, newest first. Empty when the caller has no clinic.
create or replace function public.clinic_caseload()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(app.clinic_patient_json(p.id) order by p.created_at desc), '[]'::jsonb)
  from public.patients p
  where p.clinic_id is not null
    and p.clinic_id = (select clinic_id from public.profiles where id = auth.uid());
$$;
comment on function public.clinic_caseload() is
  'Real caseload (patients + sessions + metrics) scoped to the caller''s clinic. SECURITY DEFINER.';

-- One patient's detail — only if they belong to the caller's clinic, else null.
create or replace function public.clinic_patient_overview(p_patient uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.patients p
      where p.id = p_patient
        and p.clinic_id is not null
        and p.clinic_id = (select clinic_id from public.profiles where id = auth.uid())
    ) then app.clinic_patient_json(p_patient)
    else null
  end;
$$;
comment on function public.clinic_patient_overview(uuid) is
  'Full real detail for one patient if they are in the caller''s clinic, else null. SECURITY DEFINER.';

-- Persist a portal prescription edit. Scoped: the patient must be in the caller's clinic.
create or replace function public.clinic_save_care_plan(
  p_patient    uuid,
  p_pack       text,
  p_weekly     integer,
  p_cadence    integer,
  p_difficulty numeric,
  p_note       text
)
returns public.care_plan_overrides
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid            uuid := auth.uid();
  v_caller_clinic  uuid := (select clinic_id from public.profiles where id = auth.uid());
  v_patient_clinic uuid := (select clinic_id from public.patients where id = p_patient);
  v_row            public.care_plan_overrides;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_caller_clinic is null or v_patient_clinic is distinct from v_caller_clinic then
    raise exception 'patient is not in your clinic' using errcode = '42501';
  end if;

  insert into public.care_plan_overrides as o (
    patient_id, clinic_id, pack, weekly_dose_sessions, target_cadence_spm, difficulty, note, updated_by
  ) values (
    p_patient, v_patient_clinic, p_pack,
    greatest(0, least(21, coalesce(p_weekly, 5))),
    greatest(20, least(200, coalesce(p_cadence, 67))),
    greatest(0, least(1, coalesce(p_difficulty, 0.5))),
    coalesce(p_note, ''), v_uid
  )
  on conflict (patient_id) do update set
    pack                 = excluded.pack,
    weekly_dose_sessions = excluded.weekly_dose_sessions,
    target_cadence_spm   = excluded.target_cadence_spm,
    difficulty           = excluded.difficulty,
    note                 = excluded.note,
    updated_by           = excluded.updated_by,
    updated_at           = now()
  returning * into v_row;

  return v_row;
end;
$$;
comment on function public.clinic_save_care_plan(uuid, text, integer, integer, numeric, text) is
  'Upsert a patient''s portal prescription tuning; scoped to the caller''s clinic. SECURITY DEFINER.';

grant select on public.care_plan_overrides to authenticated;
grant execute on function app.clinic_patient_json(uuid)                                  to authenticated, service_role;
grant execute on function public.clinic_caseload()                                       to authenticated;
grant execute on function public.clinic_patient_overview(uuid)                           to authenticated;
grant execute on function public.clinic_save_care_plan(uuid, text, integer, integer, numeric, text) to authenticated;
