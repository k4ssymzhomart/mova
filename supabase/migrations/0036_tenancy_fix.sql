-- 0036_tenancy_fix.sql
-- Closes issue #20's shared-tenant PHI leak on the hosted project. Applied 2026-09-16.
--
-- Built from two files on origin/fix/the-tenancyrls-holes (Theleriz, 3a2882a), renumbered because that branch's
-- 0023 collides with the already-applied 0023_patient_ble_devices and its 0024-0033 collide with other work:
--   Part 1  0023_tenancy_fix.sql: handle_new_user and provision_self_serve_patient, unchanged.
--   Part 2  0024_clinician_portal_hardening.sql: whole file, unchanged except one added revoke from public.
--
-- Why both parts. 0035 stopped signups from choosing their role but still puts every signup in the shared
-- "Mova Personal" clinic (…00a1). On 2026-09-16 that clinic held 9 real patients and no clinician or admin. The
-- leak did not need a privileged role: clinic_caseload, clinic_patient_overview and clinic_save_care_plan (0022)
-- authorize by clinic_id equality alone, and care_plan_overrides_read accepts any clinic member. So any account in
-- …00a1 -- each of the 9 patients, and anyone who signed up -- could read every patient's portal record and write
-- their care plan. Part 1 alone stops new signups joining …00a1; Part 2 is what stops members of …00a1 reading
-- each other.
--
-- Deliberately NOT included: the backfill in the source 0023 that moves every existing …00a1 patient into a
-- personal clinic and rewrites clinic_id on their rows. It would have moved the 9 real patients, and it misses
-- tables added since it was written (session_check_ins, notifications), which would leave their rows split across
-- two clinic ids. With Part 2 in place the shared clinic no longer grants cross-patient reads, so the 9 stay where
-- they are. Moving them is a separate, reviewed decision.
--
-- Unchanged by this migration: the heel-slide-test clinic, its clinician's care-team link, and every row of data.

-- ---------------------------------------------------------------------------------------------------------------
-- Part 1 -- from 0023_tenancy_fix.sql (its original header, kept for the reasoning)
-- ---------------------------------------------------------------------------------------------------------------

-- Closes the shared self-serve tenant PHI leak. Two bugs, present since
-- 0017_self_serve.sql and still current as of 0020_auth_profile_metadata.sql (the
-- latest prior redefinition of this trigger, which this migration supersedes):
--   1. app.handle_new_user() derived `role` from client-supplied raw_user_meta_data,
--      letting a signup self-declare clinician/clinic_admin.
--   2. Every self-serve patient was hardcoded into ONE shared clinic
--      (00000000-0000-0000-0000-0000000000a1, "Mova Personal"). Because clinic_id
--      equality is the tenant boundary everywhere (RLS, care_plan_overrides_read's
--      is_clinic_member branch, the clinic_caseload family in 0022), any account in
--      that shared clinic with a clinician/clinic_admin role -- however it got one --
--      could see every other self-serve patient's PHI.
--
-- Fix: every self-serve signup gets its OWN 1-patient clinic, created at auth.users
-- insert time (never via a later UPDATE profiles.clinic_id, which enforce_profile_guard
-- already blocks for authenticated end users). role is now always 'patient' for
-- self-serve signup; clinician/admin accounts are provisioned out-of-band by an
-- existing admin (permitted via enforce_profile_guard's admin bypass). The
-- full_name/display_name/avatar_url extraction from OAuth metadata (0020) and the
-- on-conflict patch-existing-profile behavior are both preserved unchanged.

create or replace function app.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_clinic uuid;
  v_full   text := coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name');
  v_given  text := new.raw_user_meta_data ->> 'given_name';
  v_avatar text := coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');
begin
  insert into public.clinics (name, slug, timezone)
  values (
    'Personal — ' || coalesce(v_full, new.email::text, new.id::text),
    'self-' || replace(new.id::text, '-', ''),
    'UTC'
  )
  returning id into v_clinic;

  -- role is ALWAYS 'patient' here -- client-supplied raw_user_meta_data->>'role' is
  -- never trusted for provisioning. A privileged role is only ever granted later, out
  -- of band, by an admin updating this profile directly (enforce_profile_guard's
  -- auth.uid() is null / is_admin() bypass).
  insert into public.profiles (id, email, full_name, display_name, avatar_url, role, clinic_id)
  values (
    new.id,
    new.email,
    v_full,
    coalesce(v_given, nullif(split_part(coalesce(v_full, new.email), ' ', 1), '')),
    v_avatar,
    'patient',
    v_clinic
  )
  on conflict (id) do update set
    email        = excluded.email,
    full_name    = coalesce(public.profiles.full_name, excluded.full_name),
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    avatar_url   = coalesce(public.profiles.avatar_url, excluded.avatar_url);
  return new;
end;
$$;
comment on function app.handle_new_user() is
  'AFTER INSERT on auth.users: create/patch the profile (name + avatar from identity metadata) as patient '
  'in a fresh 1-patient personal clinic.';

-- Idempotently ensure the caller has a self-serve patient record. No hardcoded clinic:
-- the clinic already lives on the caller's profile (set by handle_new_user above).
create or replace function public.provision_self_serve_patient()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.app_role;
  v_clinic  uuid;
  v_patient uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select role, clinic_id into v_role, v_clinic from public.profiles where id = v_uid;
  if v_role is null then
    raise exception 'profile missing for caller' using errcode = '42501';
  end if;

  if v_role is distinct from 'patient' then
    select id into v_patient from public.patients where profile_id = v_uid;
    return v_patient;  -- clinicians/admins are not auto-made patients
  end if;

  select id into v_patient from public.patients where profile_id = v_uid;
  if v_patient is null then
    insert into public.patients (profile_id, clinic_id, enrollment_status)
    values (v_uid, v_clinic, 'active')
    returning id into v_patient;
  end if;

  return v_patient;
end;
$$;
comment on function public.provision_self_serve_patient() is
  'Idempotently provision the caller as a self-serve patient in their own personal clinic.';

-- ---------------------------------------------------------------------------------------------------------------
-- Part 2 -- from 0024_clinician_portal_hardening.sql
-- ---------------------------------------------------------------------------------------------------------------

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
-- Added when renumbered: the function was also executable through the default PUBLIC grant, which the line above
-- does not remove.
revoke execute on function app.clinic_patient_json(uuid) from public, anon;
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
