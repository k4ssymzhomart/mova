-- 0043_prescription_writes.sql
-- Who may change a patient's plan, and one RPC for doing it.
--
-- 0005_programs.sql gave prescriptions and programs a single `for all` policy keyed on
-- app.can_access_patient(patient_id), and that predicate is true for the patient themselves. A patient's own
-- browser could therefore insert, edit or delete their own prescriptions over PostgREST — prescribe themselves an
-- exercise no clinician chose, or delete the one that was chosen. For a pilot with a real patient and a real
-- doctor that is the wrong way round, so the write side now requires a clinical role.
--
-- app.is_clinic_authorized_for(patient) (0036) is exactly the right gate and is already the one the clinician
-- portal reads through: a platform admin, the patient's own clinic admin, or a clinician with an ACTIVE care-team
-- link to that patient. The patient keeps SELECT, which is what the patient app reads for Today and the plan.
--
-- The same shape is applied to the camera-era per-patient tables, for the same reason: every legitimate write to
-- them goes through a SECURITY DEFINER RPC (finish_training_session, award_session_rewards,
-- flush_session_telemetry_batch, record_session_frames, record_fog_events), and those run as the function owner
-- and are unaffected by a policy on the table. Nothing in services/frontend/src writes any of these tables
-- directly — checked before writing this migration.
--
-- clinic_set_prescription is the one write the clinician portal needs: assign an exercise to a patient, change
-- its dose or frequency, or stop it. It is SECURITY DEFINER for one reason only — to keep the authorisation in a
-- single place and out of the browser — and it re-checks that gate itself on every call.

-- Plan tables: read for everyone who may see the patient, write for the care team ------------------------------

drop policy if exists prescriptions_rw on public.prescriptions;
drop policy if exists programs_rw on public.programs;

create policy prescriptions_select on public.prescriptions
  for select to authenticated using (app.can_access_patient(patient_id));
create policy prescriptions_write on public.prescriptions
  for all to authenticated
  using (app.is_clinic_authorized_for(patient_id))
  with check (app.is_clinic_authorized_for(patient_id));

create policy programs_select on public.programs
  for select to authenticated using (app.can_access_patient(patient_id));
create policy programs_write on public.programs
  for all to authenticated
  using (app.is_clinic_authorized_for(patient_id))
  with check (app.is_clinic_authorized_for(patient_id));

-- Camera-era per-patient tables: read-only for end users, written only by the RPCs ------------------------------

drop policy if exists xp_ledger_rw on public.xp_ledger;
drop policy if exists achievements_rw on public.achievements;
drop policy if exists streaks_rw on public.streaks;
drop policy if exists session_metrics_rw on public.session_metrics;
drop policy if exists fog_events_rw on public.fog_events;
drop policy if exists rom_measurements_rw on public.rom_measurements;

create policy xp_ledger_select on public.xp_ledger
  for select to authenticated using (app.can_access_patient(patient_id));
create policy achievements_select on public.achievements
  for select to authenticated using (app.can_access_patient(patient_id));
create policy streaks_select on public.streaks
  for select to authenticated using (app.can_access_patient(patient_id));
create policy session_metrics_select on public.session_metrics
  for select to authenticated using (app.can_access_patient(patient_id));
create policy fog_events_select on public.fog_events
  for select to authenticated using (app.can_access_patient(patient_id));
create policy rom_measurements_select on public.rom_measurements
  for select to authenticated using (app.can_access_patient(patient_id));

revoke insert, update, delete on
  public.xp_ledger,
  public.achievements,
  public.streaks,
  public.session_metrics,
  public.fog_events,
  public.rom_measurements
from authenticated;

-- session_frames is deliberately left alone: it is range-partitioned and its writes already go only through
-- record_session_frames and flush_session_telemetry_batch, and a policy change there needs the partition set
-- checked one by one rather than assumed.

-- The clinician's one write ------------------------------------------------------------------------------------

create or replace function public.clinic_set_prescription(
  p_patient   uuid,
  p_exercise  text,
  p_active    boolean default true,
  p_reps      integer default null,
  p_per_week  integer default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_clinic   uuid;
  v_exercise uuid;
  v_program  uuid;
  v_dose     jsonb;
  v_row      public.prescriptions;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Admin, the patient's clinic admin, or a clinician with an active care-team link. The patient themselves is
  -- deliberately not on this list: a plan is prescribed, not chosen.
  if not app.is_clinic_authorized_for(p_patient) then
    raise exception 'patient is not in your care' using errcode = '42501';
  end if;

  select clinic_id into v_clinic from public.patients where id = p_patient;
  if v_clinic is null then
    raise exception 'patient not found' using errcode = '22023';
  end if;

  select id into v_exercise from public.exercises where slug = p_exercise;
  if v_exercise is null then
    raise exception 'no exercise with slug %', p_exercise using errcode = '22023';
  end if;

  -- One active programme per patient; it is created on the first prescription rather than in a separate step.
  select id into v_program
    from public.programs
   where patient_id = p_patient and status = 'active'
   order by created_at desc
   limit 1;
  if v_program is null then
    insert into public.programs (patient_id, clinic_id, title, status)
    values (p_patient, v_clinic, 'Программа реабилитации', 'active')
    returning id into v_program;
  end if;

  select pr.* into v_row
    from public.prescriptions pr
   where pr.patient_id = p_patient and pr.exercise_id = v_exercise
   order by pr.created_at desc
   limit 1;

  -- A dose the caller did not state keeps whatever the prescription already had, or the catalogue's default.
  v_dose := coalesce(
    case when p_reps is null then null else jsonb_build_object('reps', greatest(1, least(100, p_reps))) end,
    v_row.dose,
    (select e.default_dose from public.exercises e where e.id = v_exercise),
    '{"reps": 10}'::jsonb
  );

  if v_row.id is null then
    insert into public.prescriptions (
      patient_id, clinic_id, program_id, exercise_id, status, dose, frequency_per_week, prescribed_by
    ) values (
      p_patient, v_clinic, v_program, v_exercise,
      (case when p_active then 'active' else 'paused' end)::public.prescription_status,
      v_dose,
      greatest(1, least(21, coalesce(p_per_week, 3))),
      app.user_clinician_id()
    )
    returning * into v_row;
  else
    update public.prescriptions
       set status             = (case when p_active then 'active' else 'paused' end)::public.prescription_status,
           dose               = v_dose,
           frequency_per_week = greatest(1, least(21, coalesce(p_per_week, frequency_per_week, 3))),
           program_id         = coalesce(program_id, v_program),
           prescribed_by      = coalesce(app.user_clinician_id(), prescribed_by)
     where id = v_row.id
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'exercise', p_exercise,
    'status', v_row.status,
    'dose', v_row.dose,
    'frequency_per_week', v_row.frequency_per_week
  );
end;
$$;
comment on function public.clinic_set_prescription(uuid, text, boolean, integer, integer) is
  'Assign, re-dose or stop one exercise for a patient. Caller must be admin, the patient''s clinic admin, or a '
  'clinician actively linked to them. SECURITY DEFINER.';

grant execute on function public.clinic_set_prescription(uuid, text, boolean, integer, integer) to authenticated;
