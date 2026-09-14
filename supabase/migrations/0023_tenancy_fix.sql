-- 0023_tenancy_fix.sql
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

-- Backfill: every existing self-serve patient sharing the old "Mova Personal" clinic
-- gets split into their own personal clinic, and every denormalized clinic_id column
-- on their rows is repointed. Runs in migration context (auth.uid() is null), so
-- enforce_profile_guard's end-user restriction does not apply. The old shared clinic
-- row is left in place (FK-safe) but is no longer referenced by any patient going
-- forward. audit_log is a historical record and is deliberately left untouched.
do $$
declare
  v_old_clinic constant uuid := '00000000-0000-0000-0000-0000000000a1';
  v_row        record;
  v_new_clinic uuid;
begin
  for v_row in
    select p.id as patient_id, p.profile_id, pr.full_name
    from public.patients p
    join public.profiles pr on pr.id = p.profile_id
    where p.clinic_id = v_old_clinic and pr.role = 'patient'
  loop
    insert into public.clinics (name, slug, timezone)
    values (
      'Personal — ' || coalesce(v_row.full_name, v_row.profile_id::text),
      'self-' || replace(v_row.profile_id::text, '-', ''),
      'UTC'
    )
    returning id into v_new_clinic;

    update public.profiles           set clinic_id = v_new_clinic where id = v_row.profile_id;
    update public.patients           set clinic_id = v_new_clinic where id = v_row.patient_id;
    update public.care_team_links    set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.programs           set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.prescriptions      set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.goals              set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.schedules          set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.sessions           set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.session_metrics    set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.session_frames     set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.fog_events         set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.rom_measurements   set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.achievements       set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.xp_ledger          set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.streaks            set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.messages           set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.consents           set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.inference_jobs     set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
    update public.care_plan_overrides set clinic_id = v_new_clinic where patient_id = v_row.patient_id;
  end loop;
end;
$$;
