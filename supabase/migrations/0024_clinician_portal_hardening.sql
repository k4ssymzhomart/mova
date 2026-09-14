-- 0024_clinician_portal_hardening.sql
-- 0022_clinician_portal.sql's three RPCs (clinic_caseload, clinic_patient_overview,
-- clinic_save_care_plan) authorize by raw `patients.clinic_id = caller's
-- profiles.clinic_id` equality only -- never role, never care_team_links. That means
-- a plain `clinician` account matches any patient sharing its clinic_id, bypassing
-- care_team_links entirely (only a clinic_admin should see the whole clinic; a
-- clinician should only see patients they are actively linked to). 0023 already
-- shrinks the blast radius (self-serve patients no longer share one clinic), but a
-- real clinic's own role model still needs this fixed independently.

-- Caller may see this patient's clinician-portal record: admin, this patient's
-- clinic_admin, or a clinician actively linked to this patient via care_team_links.
create or replace function app.is_clinic_authorized_for(p_patient uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    app.is_admin()
    or (
      app.is_clinic_admin()
      and exists (
        select 1 from public.patients p
        where p.id = p_patient and p.clinic_id = app.user_clinic_id()
      )
    )
    or (
      app.user_clinician_id() is not null
      and exists (
        select 1 from public.care_team_links l
        where l.patient_id = p_patient
          and l.is_active
          and l.clinician_id = app.user_clinician_id()
      )
    );
$$;
comment on function app.is_clinic_authorized_for(uuid) is
  'Clinician-portal gate: admin | this patient''s clinic_admin | a clinician actively linked to this patient.';

create or replace function public.clinic_caseload()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(app.clinic_patient_json(p.id) order by p.created_at desc), '[]'::jsonb)
  from public.patients p
  where app.is_clinic_authorized_for(p.id);
$$;
comment on function public.clinic_caseload() is
  'Real caseload (patients + sessions + metrics) scoped by role: admin sees all, clinic_admin sees their '
  'clinic, clinician sees only actively-linked patients. SECURITY DEFINER.';

create or replace function public.clinic_patient_overview(p_patient uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when app.is_clinic_authorized_for(p_patient) then app.clinic_patient_json(p_patient) else null end;
$$;
comment on function public.clinic_patient_overview(uuid) is
  'Full real detail for one patient if the caller is authorized for them, else null. SECURITY DEFINER.';

-- Writes additionally require a clinical role: a patient who legitimately passes
-- can_access_patient's self-branch elsewhere must never be able to call this
-- clinician-only write RPC on their own row.
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
  v_patient_clinic uuid := (select clinic_id from public.patients where id = p_patient);
  v_row            public.care_plan_overrides;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (app.is_admin() or app.is_clinician()) then
    raise exception 'caller is not a clinician' using errcode = '42501';
  end if;
  if v_patient_clinic is null or not app.is_clinic_authorized_for(p_patient) then
    raise exception 'patient is not in your care' using errcode = '42501';
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
  'Upsert a patient''s portal prescription tuning; caller must be an authorized clinician/admin. SECURITY DEFINER.';

-- app.clinic_patient_json carries no auth check of its own by design -- it must only
-- ever be reached through the authorized RPCs above, never called directly.
revoke execute on function app.clinic_patient_json(uuid) from authenticated;
grant execute on function app.clinic_patient_json(uuid) to service_role;

-- Bonus finding: care_plan_overrides_read (0022) also grants SELECT via
-- app.is_clinic_member(clinic_id), which is true for ANY profile sharing that
-- clinic_id -- including an unrelated clinician, or another patient, in a real
-- multi-patient clinic -- bypassing care_team_links entirely. can_access_patient()
-- already covers every legitimate reader (self, linked clinician, clinic_admin,
-- admin), so drop the over-broad branch.
drop policy if exists care_plan_overrides_read on public.care_plan_overrides;
create policy care_plan_overrides_read on public.care_plan_overrides
  for select to authenticated
  using (app.can_access_patient(patient_id));
