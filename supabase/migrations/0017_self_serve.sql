-- 0017_self_serve.sql
-- Self-serve consumer onboarding for direct sign-ups (Google OAuth / email).
--
-- The Phase-1 schema is clinic-first: a session needs a patient + clinic. For
-- individuals who sign up themselves (no clinician invite), we attach them to a
-- single shared "Mova Personal" tenant and provision a patient record, then open
-- a UNIQUE training session per workout. Every RPC is SECURITY DEFINER but strictly
-- scoped to auth.uid(); RLS (can_access_patient) still governs all direct table I/O.

-- Stable id for the self-serve tenant (distinct from the seeded demo clinic).
insert into public.clinics (id, name, slug, timezone)
values ('00000000-0000-0000-0000-0000000000a1', 'Mova Personal', 'mova-personal', 'UTC')
on conflict (id) do nothing;

-- Provision new patient-role users into the personal clinic AT INSERT time, so we
-- never UPDATE profiles.clinic_id (which the enforce_profile_guard trigger blocks
-- for end users). Clinician / clinic_admin sign-ups are left unclinic'd for an
-- admin to place. Supersedes the definition in 0015_auth_hooks.sql.
create or replace function app.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.app_role :=
    coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'patient');
begin
  insert into public.profiles (id, email, full_name, role, clinic_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    v_role,
    case when v_role = 'patient'
         then '00000000-0000-0000-0000-0000000000a1'::uuid
         else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
comment on function app.handle_new_user() is
  'AFTER INSERT on auth.users: create the matching profile; patients join the Mova Personal clinic.';

-- Idempotently ensure the caller has a self-serve patient record. Returns its id
-- (null for non-patient roles, who are not self-serve patients).
create or replace function public.provision_self_serve_patient()
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_clinic  uuid := '00000000-0000-0000-0000-0000000000a1';
  v_role    public.app_role;
  v_patient uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Safety net if the new-user trigger did not run (e.g. pre-existing user).
  insert into public.profiles (id, role, clinic_id)
  values (v_uid, 'patient', v_clinic)
  on conflict (id) do nothing;

  select role into v_role from public.profiles where id = v_uid;
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
  'Idempotently provision the caller as a self-serve patient in the Mova Personal clinic.';

-- Open a UNIQUE in-progress training session for the caller. Auto-provisions the
-- patient, so the very first workout after sign-up just works. Returns the row.
create or replace function public.start_training_session(
  p_exercise_slug text default null,
  p_device_info   jsonb default '{}'::jsonb
)
returns public.sessions
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_patient  uuid;
  v_clinic   uuid;
  v_exercise uuid;
  v_session  public.sessions;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  v_patient := public.provision_self_serve_patient();
  if v_patient is null then
    raise exception 'caller has no patient record' using errcode = '42501';
  end if;

  select clinic_id into v_clinic from public.patients where id = v_patient;

  if p_exercise_slug is not null then
    select id into v_exercise from public.exercises where slug = p_exercise_slug;
  end if;

  insert into public.sessions (patient_id, clinic_id, exercise_id, status, device_info, started_at)
  values (v_patient, v_clinic, v_exercise, 'in_progress', coalesce(p_device_info, '{}'::jsonb), now())
  returning * into v_session;

  return v_session;
end;
$$;
comment on function public.start_training_session(text, jsonb) is
  'Create a unique in-progress training session for the caller (auto-provisions the patient).';

-- Close the caller''s session and upsert its aggregate metrics. Scoped to the
-- caller''s own patient_id so it can never touch another patient''s session.
create or replace function public.finish_training_session(
  p_session uuid,
  p_summary jsonb default '{}'::jsonb,
  p_metrics jsonb default '{}'::jsonb
)
returns public.sessions
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_patient uuid;
  v_clinic  uuid;
  v_session public.sessions;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id, clinic_id into v_patient, v_clinic
  from public.patients where profile_id = v_uid;
  if v_patient is null then
    raise exception 'caller has no patient record' using errcode = '42501';
  end if;

  update public.sessions
     set status   = 'completed',
         ended_at = now(),
         summary  = coalesce(p_summary, '{}'::jsonb)
   where id = p_session and patient_id = v_patient
   returning * into v_session;

  if v_session.id is null then
    raise exception 'session not found for caller' using errcode = '42501';
  end if;

  if p_metrics is not null and p_metrics <> '{}'::jsonb then
    insert into public.session_metrics (
      session_id, patient_id, clinic_id,
      reps, rom_max, rom_mean, smoothness, symmetry, quality_score, adherence, fog_risk, extras
    ) values (
      p_session, v_patient, v_clinic,
      (p_metrics ->> 'reps')::int,
      (p_metrics ->> 'rom_max')::numeric,
      (p_metrics ->> 'rom_mean')::numeric,
      (p_metrics ->> 'smoothness')::numeric,
      (p_metrics ->> 'symmetry')::numeric,
      (p_metrics ->> 'quality_score')::numeric,
      (p_metrics ->> 'adherence')::numeric,
      (p_metrics ->> 'fog_risk')::numeric,
      p_metrics
    )
    on conflict (session_id) do update set
      reps          = excluded.reps,
      rom_max       = excluded.rom_max,
      rom_mean      = excluded.rom_mean,
      smoothness    = excluded.smoothness,
      symmetry      = excluded.symmetry,
      quality_score = excluded.quality_score,
      adherence     = excluded.adherence,
      fog_risk      = excluded.fog_risk,
      extras        = excluded.extras,
      computed_at   = now();
  end if;

  return v_session;
end;
$$;
comment on function public.finish_training_session(uuid, jsonb, jsonb) is
  'Mark the caller''s session completed and upsert its aggregate metrics.';

grant execute on function public.provision_self_serve_patient()            to authenticated;
grant execute on function public.start_training_session(text, jsonb)       to authenticated;
grant execute on function public.finish_training_session(uuid, jsonb, jsonb) to authenticated;
