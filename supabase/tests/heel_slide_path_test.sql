-- heel_slide_path_test.sql — proof of the Heel Slide database path (0034_heel_slide_path.sql).
--
-- Self-checking without pgTAP (the hosted project does not have it): every check raises an exception on
-- failure, which aborts the transaction, so reaching the final select means every check passed. That select
-- prints one TAP line per check ("ok N - name", then "1..N"), so pg_prove-based runners read it as well.
--
-- Runs in one transaction that always ends in rollback. It builds its own throwaway clinics, users, patients,
-- clinicians, programs and prescriptions, then impersonates each user with `set local role authenticated` and
-- request.jwt.claims (auth.uid() reads `sub` from the claim). It needs migrations up to 0035 applied (the signup
-- check relies on 0035's new-user trigger), and does not use the 'knee_flexion_extension' enum value, which
-- cannot be used in the transaction that adds it.
--
-- Covered:
--   - signup metadata cannot choose a role: every new account is a patient in Mova Personal (0035)
--   - a patient starts a session only from their own active prescription in their own active program
--   - a new start of a prescription aborts the caller's session of it left in progress, and nothing else
--   - finish_prescribed_session: in-progress sessions only (55000 otherwise), summary validated, no metrics
--   - telemetry reaches session_frames through flush_session_telemetry_batch, idempotently; once a session has
--     ended, rows recorded before the end are still stored and rows recorded after it are skipped
--   - check-in: refused before completion, every field validated, "none" stripped, note trimmed, idempotent
--   - no direct client writes to session_check_ins; anon cannot execute the RPCs
--   - check-ins and clinician reads: the patient, a linked active clinician and the patient's clinic_admin only;
--     null / no rows for another patient, an unlinked, inactive-link or deactivated clinician, another clinic's
--     admin, and an account whose signup asked for admin
--   - the clinician result never shows a prescription that belongs to another patient

begin;

select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);

-- ── Assertion helpers (session-local, gone with the transaction) ───────────────────────────────────────────
create function pg_temp.hs_pass(p_name text)
returns void
language sql
as $$
  select set_config('heel_slide_test.passed', coalesce(current_setting('heel_slide_test.passed', true), '') || p_name || E'\n', true);
$$;

create function pg_temp.hs_assert(p_ok boolean, p_name text)
returns void
language plpgsql
as $$
begin
  if p_ok is not true then
    raise exception 'FAIL: %', p_name;
  end if;
  perform pg_temp.hs_pass(p_name);
end;
$$;

-- Runs p_sql as the current role and requires it to fail with exactly p_state.
create function pg_temp.hs_expect_error(p_sql text, p_state text, p_name text)
returns void
language plpgsql
as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
    v_msg := sqlerrm;
  end;
  if v_state is distinct from p_state then
    raise exception 'FAIL: % (expected SQLSTATE %, got %: %)', p_name, p_state, coalesce(v_state, 'no error'), v_msg;
  end if;
  perform pg_temp.hs_pass(p_name);
end;
$$;

create function pg_temp.hs_act_as(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims',
                    case when p_user is null then ''
                         else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
$$;

-- ── Fixtures (as the migration owner; RLS bypassed) ────────────────────────────────────────────────────────
insert into public.clinics (id, name, slug, timezone) values
  ('4ee15000-0000-4000-8000-0000000000c1', 'Heel slide test A', 'hs-test-clinic-a', 'Asia/Almaty'),
  ('4ee15000-0000-4000-8000-0000000000c2', 'Heel slide test B', 'hs-test-clinic-b', 'Asia/Almaty');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated',
   'hs-test-patient-1@heel-slide.test', 'x', now(), '{}', '{"full_name":"Test Patient One"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated',
   'hs-test-patient-2@heel-slide.test', 'x', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated',
   'hs-test-clin-linked@heel-slide.test', 'x', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated',
   'hs-test-clin-unlinked@heel-slide.test', 'x', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000b3', 'authenticated', 'authenticated',
   'hs-test-clin-inactive@heel-slide.test', 'x', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000b4', 'authenticated', 'authenticated',
   'hs-test-clin-deactivated@heel-slide.test', 'x', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated',
   'hs-test-admin-a@heel-slide.test', 'x', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000d2', 'authenticated', 'authenticated',
   'hs-test-admin-b@heel-slide.test', 'x', now(), '{}', '{}', now(), now());

-- The new-user trigger made every one of them a patient in Mova Personal (0035). Roles and clinics are granted the
-- way a trusted backend grants them: there is no signed-in user here, so app.enforce_profile_guard allows it.
update public.profiles p
   set role = f.role::public.app_role, clinic_id = f.clinic_id
  from (values
    ('4ee15000-0000-4000-8000-0000000000a1'::uuid, 'patient',      '4ee15000-0000-4000-8000-0000000000c1'::uuid),
    ('4ee15000-0000-4000-8000-0000000000a2'::uuid, 'patient',      '4ee15000-0000-4000-8000-0000000000c1'::uuid),
    ('4ee15000-0000-4000-8000-0000000000b1'::uuid, 'clinician',    '4ee15000-0000-4000-8000-0000000000c1'::uuid),
    ('4ee15000-0000-4000-8000-0000000000b2'::uuid, 'clinician',    '4ee15000-0000-4000-8000-0000000000c1'::uuid),
    ('4ee15000-0000-4000-8000-0000000000b3'::uuid, 'clinician',    '4ee15000-0000-4000-8000-0000000000c1'::uuid),
    ('4ee15000-0000-4000-8000-0000000000b4'::uuid, 'clinician',    '4ee15000-0000-4000-8000-0000000000c1'::uuid),
    ('4ee15000-0000-4000-8000-0000000000d1'::uuid, 'clinic_admin', '4ee15000-0000-4000-8000-0000000000c1'::uuid),
    ('4ee15000-0000-4000-8000-0000000000d2'::uuid, 'clinic_admin', '4ee15000-0000-4000-8000-0000000000c2'::uuid)
  ) as f (id, role, clinic_id)
 where p.id = f.id;

-- Linked, unlinked and inactive-link clinicians are active; the deactivated one keeps an active link, which must
-- not be enough on its own.
insert into public.clinicians (id, profile_id, clinic_id, is_active) values
  ('4ee15000-0000-4000-8000-000000000cb1', '4ee15000-0000-4000-8000-0000000000b1', '4ee15000-0000-4000-8000-0000000000c1', true),
  ('4ee15000-0000-4000-8000-000000000cb2', '4ee15000-0000-4000-8000-0000000000b2', '4ee15000-0000-4000-8000-0000000000c1', true),
  ('4ee15000-0000-4000-8000-000000000cb3', '4ee15000-0000-4000-8000-0000000000b3', '4ee15000-0000-4000-8000-0000000000c1', true),
  ('4ee15000-0000-4000-8000-000000000cb4', '4ee15000-0000-4000-8000-0000000000b4', '4ee15000-0000-4000-8000-0000000000c1', false);

insert into public.patients (id, profile_id, clinic_id, affected_side) values
  ('4ee15000-0000-4000-8000-000000000aa1', '4ee15000-0000-4000-8000-0000000000a1', '4ee15000-0000-4000-8000-0000000000c1', 'right'),
  ('4ee15000-0000-4000-8000-000000000aa2', '4ee15000-0000-4000-8000-0000000000a2', '4ee15000-0000-4000-8000-0000000000c1', 'left');

-- Linked clinician: active link to patient 1. Inactive-link clinician: a link that was switched off. Deactivated
-- clinician: an active link, but the clinician record is switched off. The unlinked clinician shares the clinic
-- and nothing else, which must not be enough.
insert into public.care_team_links (clinic_id, clinician_id, patient_id, is_active) values
  ('4ee15000-0000-4000-8000-0000000000c1', '4ee15000-0000-4000-8000-000000000cb1', '4ee15000-0000-4000-8000-000000000aa1', true),
  ('4ee15000-0000-4000-8000-0000000000c1', '4ee15000-0000-4000-8000-000000000cb3', '4ee15000-0000-4000-8000-000000000aa1', false),
  ('4ee15000-0000-4000-8000-0000000000c1', '4ee15000-0000-4000-8000-000000000cb4', '4ee15000-0000-4000-8000-000000000aa1', true);

insert into public.exercises (id, slug, name, modality, is_published, default_dose, scoring_rubric) values
  ('4ee15000-0000-4000-8000-0000000000e1', 'hs-test-exercise', 'Heel slide test exercise', 'sit_to_stand_lower_limb',
   false, '{"reps": 10}', '{"schema": "exercise_config/heel_slide_path.v1", "min_valid_excursion_deg": 22.5}');

insert into public.programs (id, patient_id, clinic_id, status) values
  ('4ee15000-0000-4000-8000-000000000f01', '4ee15000-0000-4000-8000-000000000aa1', '4ee15000-0000-4000-8000-0000000000c1', 'active'),
  ('4ee15000-0000-4000-8000-000000000f02', '4ee15000-0000-4000-8000-000000000aa1', '4ee15000-0000-4000-8000-0000000000c1', 'paused'),
  ('4ee15000-0000-4000-8000-000000000f03', '4ee15000-0000-4000-8000-000000000aa2', '4ee15000-0000-4000-8000-0000000000c1', 'active');

insert into public.prescriptions (id, program_id, patient_id, clinic_id, exercise_id, dose, status, prescribed_by) values
  -- patient 1: active prescription in the active program
  ('4ee15000-0000-4000-8000-000000001001', '4ee15000-0000-4000-8000-000000000f01', '4ee15000-0000-4000-8000-000000000aa1',
   '4ee15000-0000-4000-8000-0000000000c1', '4ee15000-0000-4000-8000-0000000000e1', '{"reps": 10}', 'active', '4ee15000-0000-4000-8000-000000000cb1'),
  -- patient 1: paused prescription in the active program
  ('4ee15000-0000-4000-8000-000000001002', '4ee15000-0000-4000-8000-000000000f01', '4ee15000-0000-4000-8000-000000000aa1',
   '4ee15000-0000-4000-8000-0000000000c1', '4ee15000-0000-4000-8000-0000000000e1', '{"reps": 10}', 'paused', '4ee15000-0000-4000-8000-000000000cb1'),
  -- patient 1: active prescription inside a paused program
  ('4ee15000-0000-4000-8000-000000001003', '4ee15000-0000-4000-8000-000000000f02', '4ee15000-0000-4000-8000-000000000aa1',
   '4ee15000-0000-4000-8000-0000000000c1', '4ee15000-0000-4000-8000-0000000000e1', '{"reps": 10}', 'active', '4ee15000-0000-4000-8000-000000000cb1'),
  -- patient 2: their own active prescription
  ('4ee15000-0000-4000-8000-000000001004', '4ee15000-0000-4000-8000-000000000f03', '4ee15000-0000-4000-8000-000000000aa2',
   '4ee15000-0000-4000-8000-0000000000c1', '4ee15000-0000-4000-8000-0000000000e1', '{"reps": 10}', 'active', null),
  -- patient 1: two more active prescriptions in the active program (superseding, late rows, repointing)
  ('4ee15000-0000-4000-8000-000000001005', '4ee15000-0000-4000-8000-000000000f01', '4ee15000-0000-4000-8000-000000000aa1',
   '4ee15000-0000-4000-8000-0000000000c1', '4ee15000-0000-4000-8000-0000000000e1', '{"reps": 10}', 'active', '4ee15000-0000-4000-8000-000000000cb1'),
  ('4ee15000-0000-4000-8000-000000001006', '4ee15000-0000-4000-8000-000000000f01', '4ee15000-0000-4000-8000-000000000aa1',
   '4ee15000-0000-4000-8000-0000000000c1', '4ee15000-0000-4000-8000-0000000000e1', '{"reps": 10}', 'active', '4ee15000-0000-4000-8000-000000000cb1');

-- ── Signup metadata cannot choose a role (0035) ────────────────────────────────────────────────────────────
-- raw_user_meta_data is whatever a browser sends as options.data to /auth/v1/signup.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated',
   'hs-test-meta-admin@heel-slide.test', 'x', now(), '{}', '{"role":"admin","full_name":"Meta Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000f2', 'authenticated', 'authenticated',
   'hs-test-meta-clinic-admin@heel-slide.test', 'x', now(), '{}', '{"role":"clinic_admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000f3', 'authenticated', 'authenticated',
   'hs-test-meta-clinician@heel-slide.test', 'x', now(), '{}', '{"role":"clinician"}', now(), now());

select pg_temp.hs_assert(
  (select count(*) = 3
      and bool_and(p.role = 'patient' and p.clinic_id = '00000000-0000-0000-0000-0000000000a1')
      and bool_and(p.id <> '4ee15000-0000-4000-8000-0000000000f1' or p.full_name = 'Meta Admin')
   from public.profiles p
   where p.id in ('4ee15000-0000-4000-8000-0000000000f1', '4ee15000-0000-4000-8000-0000000000f2',
                  '4ee15000-0000-4000-8000-0000000000f3')),
  'an account whose signup metadata asks for admin, clinic_admin or clinician is created as a patient in Mova Personal');

-- ── Grants ─────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.hs_assert(
  not has_table_privilege('authenticated', 'public.session_check_ins', 'insert')
  and not has_table_privilege('authenticated', 'public.session_check_ins', 'update')
  and not has_table_privilege('authenticated', 'public.session_check_ins', 'delete')
  and not has_table_privilege('anon', 'public.session_check_ins', 'select')
  and has_table_privilege('authenticated', 'public.session_check_ins', 'select'),
  'session_check_ins: authenticated may only select, anon has nothing');
select pg_temp.hs_assert(
  not has_function_privilege('anon', 'public.start_prescribed_session(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.finish_prescribed_session(uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.flush_session_telemetry_batch(uuid, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.submit_session_check_in(uuid, integer, integer, integer, text, text[], text, text)', 'execute')
  and not has_function_privilege('anon', 'public.clinician_patient_sessions(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.clinician_session_result(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.start_prescribed_session(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.finish_prescribed_session(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.flush_session_telemetry_batch(uuid, jsonb, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.submit_session_check_in(uuid, integer, integer, integer, text, text[], text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.clinician_patient_sessions(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.clinician_session_result(uuid)', 'execute'),
  'RPCs: executable by authenticated, not by anon');

set local role anon;
select pg_temp.hs_expect_error(
  $q$select public.start_prescribed_session('4ee15000-0000-4000-8000-000000001001'::uuid, '{}'::jsonb)$q$,
  '42501', 'anon cannot call start_prescribed_session');
select pg_temp.hs_expect_error(
  $q$select public.finish_prescribed_session('4ee15000-0000-4000-8000-00000000ffff'::uuid, '{}'::jsonb)$q$,
  '42501', 'anon cannot call finish_prescribed_session');
reset role;

-- ── Patient 1: starting sessions ───────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000a1');

select set_config('heel_slide_test.s1', s.id::text, true)
from public.start_prescribed_session(
  '4ee15000-0000-4000-8000-000000001001',
  '{"transport": "web-bluetooth", "model_label": "WT901BLE68 (unverified)", "roles": {"thigh": {"device_id": "t"}}}'
) s;

select pg_temp.hs_assert(
  (select s.status = 'in_progress'
      and s.patient_id = '4ee15000-0000-4000-8000-000000000aa1'
      and s.clinic_id = '4ee15000-0000-4000-8000-0000000000c1'
      and s.program_id = '4ee15000-0000-4000-8000-000000000f01'
      and s.prescription_id = '4ee15000-0000-4000-8000-000000001001'
      and s.exercise_id = '4ee15000-0000-4000-8000-0000000000e1'
      and s.device_info ->> 'transport' = 'web-bluetooth'
   from public.sessions s where s.id = current_setting('heel_slide_test.s1')::uuid),
  'start_prescribed_session opens an in_progress session carrying program, prescription, exercise, device_info');

select pg_temp.hs_expect_error(
  $q$select public.start_prescribed_session('4ee15000-0000-4000-8000-000000001004'::uuid)$q$,
  '42501', 'a patient cannot start a session from another patient''s prescription');
select pg_temp.hs_expect_error(
  $q$select public.start_prescribed_session('4ee15000-0000-4000-8000-00000000ffff'::uuid)$q$,
  '42501', 'an unknown prescription is refused');
select pg_temp.hs_expect_error(
  $q$select public.start_prescribed_session('4ee15000-0000-4000-8000-000000001002'::uuid)$q$,
  '55000', 'a paused prescription cannot start a session');
select pg_temp.hs_expect_error(
  $q$select public.start_prescribed_session('4ee15000-0000-4000-8000-000000001003'::uuid)$q$,
  '55000', 'an active prescription inside a paused program cannot start a session');
select pg_temp.hs_expect_error(
  $q$select public.start_prescribed_session('4ee15000-0000-4000-8000-000000001001'::uuid, '[1, 2]'::jsonb)$q$,
  '22023', 'device_info must be a JSON object');
select pg_temp.hs_assert(
  (select status = 'in_progress' from public.sessions where id = current_setting('heel_slide_test.s1')::uuid),
  'a refused start does not touch the session already in progress');

-- ── Patient 1: telemetry and finish ────────────────────────────────────────────────────────────────────────
-- 30 frames cycling thigh/shank/foot every 20 ms with integer pitch, plus one shank frame without euler_deg.
select set_config('heel_slide_test.frames', ((
  select jsonb_agg(jsonb_build_object(
           'recorded_at', date_trunc('second', now()) + (i / 3) * interval '20 milliseconds',
           'seq', i,
           'imu', jsonb_build_object(
             'role', (array['thigh', 'shank', 'foot'])[i % 3 + 1],
             'euler_deg', jsonb_build_array(1.5, case i % 3 when 0 then 170 + i / 3 when 1 then -175 + i / 3 else 10 end, -3),
             'validation_status', 'unverified_checksum'),
           'quality', null
         ) order by i)
  from generate_series(0, 29) as i
) || jsonb_build_array(jsonb_build_object(
       'recorded_at', date_trunc('second', now()) + 10 * interval '20 milliseconds',
       'seq', 30,
       'imu', jsonb_build_object('role', 'shank', 'validation_status', 'unverified_checksum'),
       'quality', null
     )))::text, true);

select pg_temp.hs_assert(
  (select (r ->> 'frames')::int = 31 and (r ->> 'skipped')::int = 0 and (r ->> 'skipped_events')::int = 0
   from (select public.flush_session_telemetry_batch(current_setting('heel_slide_test.s1')::uuid,
           current_setting('heel_slide_test.frames')::jsonb, '[]'::jsonb) as r) x),
  'flush_session_telemetry_batch stores 31 frames into an in-progress session and skips none');
select pg_temp.hs_assert(
  (select (r ->> 'frames')::int = 0 and (r ->> 'skipped')::int = 0
   from (select public.flush_session_telemetry_batch(current_setting('heel_slide_test.s1')::uuid,
           current_setting('heel_slide_test.frames')::jsonb, '[]'::jsonb) as r) x),
  'resending the same batch stores nothing (idempotent on session_id, recorded_at, seq)');

select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 1, 1, 3, %L, null, null, %L)',
         current_setting('heel_slide_test.s1'), 'same', 'ru'),
  '55000', 'check-in is refused while the session is still in progress');

select pg_temp.hs_expect_error(
  $q$select public.finish_prescribed_session(current_setting('heel_slide_test.s1')::uuid, '[1, 2]'::jsonb)$q$,
  '22023', 'finish_prescribed_session rejects a summary that is not a JSON object');
select pg_temp.hs_expect_error(
  $q$select public.finish_prescribed_session(current_setting('heel_slide_test.s1')::uuid, null)$q$,
  '22023', 'finish_prescribed_session rejects a null summary');
select pg_temp.hs_expect_error(
  $q$select public.finish_prescribed_session(current_setting('heel_slide_test.s1')::uuid, jsonb_build_object('pad', repeat('x', 70000)))$q$,
  '22023', 'finish_prescribed_session rejects a summary over 64 KB');
select pg_temp.hs_expect_error(
  $q$select public.finish_prescribed_session('4ee15000-0000-4000-8000-00000000ffff'::uuid, '{}'::jsonb)$q$,
  '42501', 'finish_prescribed_session refuses an unknown session');
select pg_temp.hs_assert(
  (select status = 'in_progress' and ended_at is null and summary = '{}'::jsonb
   from public.sessions where id = current_setting('heel_slide_test.s1')::uuid),
  'a rejected finish leaves the session in progress with no summary');

select pg_temp.hs_assert(
  (select f.status = 'completed' and f.ended_at = now()
      and f.summary = '{"kind": "heel_slide_path.v1", "reps_counted_on_device": 3}'::jsonb
   from public.finish_prescribed_session(current_setting('heel_slide_test.s1')::uuid,
          '{"kind": "heel_slide_path.v1", "reps_counted_on_device": 3}'::jsonb) f),
  'finish_prescribed_session completes an in-progress session with its summary and end time');
select pg_temp.hs_assert(
  (select count(*) from public.session_metrics where session_id = current_setting('heel_slide_test.s1')::uuid) = 0,
  'finish_prescribed_session writes no session_metrics');
select pg_temp.hs_expect_error(
  $q$select public.finish_prescribed_session(current_setting('heel_slide_test.s1')::uuid, '{"kind": "heel_slide_path.v1", "reps_counted_on_device": 0}'::jsonb)$q$,
  '55000', 'a completed session cannot be finished again (55000)');
select pg_temp.hs_assert(
  (select status = 'completed' and (summary ->> 'reps_counted_on_device')::int = 3
   from public.sessions where id = current_setting('heel_slide_test.s1')::uuid),
  'the refused second finish left the stored summary unchanged');

-- ── Patient 1: check-in validation ─────────────────────────────────────────────────────────────────────────
select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 11, 0, 3, %L, null, null, %L)', current_setting('heel_slide_test.s1'), 'same', 'ru'),
  '22023', 'pain_before above 10 is rejected');
select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 0, -1, 3, %L, null, null, %L)', current_setting('heel_slide_test.s1'), 'same', 'ru'),
  '22023', 'pain_after below 0 is rejected');
select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 0, 0, null, %L, null, null, %L)', current_setting('heel_slide_test.s1'), 'same', 'ru'),
  '22023', 'a missing difficulty is rejected');
select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 0, 0, 3, null, null, null, %L)', current_setting('heel_slide_test.s1'), 'ru'),
  '22023', 'knee_feels is required');
select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 0, 0, 3, %L, null, null, %L)', current_setting('heel_slide_test.s1'), 'fine', 'ru'),
  '22023', 'an unknown knee_feels value is rejected');
select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 0, 0, 3, %L, %L::text[], null, %L)', current_setting('heel_slide_test.s1'), 'same', '{none,swelling}', 'ru'),
  '22023', '"none" together with a symptom is rejected');
select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 0, 0, 3, %L, %L::text[], null, %L)', current_setting('heel_slide_test.s1'), 'same', '{fever}', 'ru'),
  '22023', 'an unknown symptom is rejected');
select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 0, 0, 3, %L, array[%L, null]::text[], null, %L)', current_setting('heel_slide_test.s1'), 'same', 'redness', 'ru'),
  '22023', 'a null symptom is rejected');
select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 0, 0, 3, %L, null, null, %L)', current_setting('heel_slide_test.s1'), 'same', 'de'),
  '22023', 'an unsupported language is rejected');
select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 0, 0, 3, %L, %L::text[], %L, %L)', current_setting('heel_slide_test.s1'), 'same', '{other}', repeat('x', 281), 'ru'),
  '22023', 'an other_note longer than 280 characters is rejected');
select pg_temp.hs_assert(
  (select count(*) from public.session_check_ins) = 0,
  'no rejected submit left a row behind');

-- ── Patient 1: a valid check-in, then idempotency ──────────────────────────────────────────────────────────
select pg_temp.hs_assert(
  (select ci.pain_before = 2 and ci.pain_after = 3 and ci.difficulty = 4 and ci.knee_feels = 'same'
      and ci.symptoms = array['swelling', 'other']::text[]
      and ci.other_note = 'tight behind the knee'
      and ci.language = 'ru'
      and ci.patient_id = '4ee15000-0000-4000-8000-000000000aa1'
      and ci.clinic_id = '4ee15000-0000-4000-8000-0000000000c1'
   from public.submit_session_check_in(current_setting('heel_slide_test.s1')::uuid, 2, 3, 4, 'same',
          array['other', 'swelling', 'swelling'], E'  tight behind the knee \n', 'ru') ci),
  'a valid check-in is stored with symptoms de-duplicated in fixed order and the note trimmed');

select set_config('heel_slide_test.ci1', (select id::text from public.session_check_ins
  where session_id = current_setting('heel_slide_test.s1')::uuid), true);

select pg_temp.hs_assert(
  (select ci.id = current_setting('heel_slide_test.ci1')::uuid and ci.pain_before = 2 and ci.knee_feels = 'same'
      and ci.symptoms = array['swelling', 'other']::text[]
   from public.submit_session_check_in(current_setting('heel_slide_test.s1')::uuid, 9, 9, 9, 'much_worse',
          array['redness'], null, 'en') ci)
  and (select count(*) from public.session_check_ins where session_id = current_setting('heel_slide_test.s1')::uuid) = 1,
  'a second submit returns the stored check-in unchanged');

select pg_temp.hs_expect_error(
  format('insert into public.session_check_ins (session_id, patient_id, clinic_id, pain_before, pain_after, difficulty, knee_feels, language) values (%L, %L, %L, 0, 0, 0, %L, %L)',
         current_setting('heel_slide_test.s1'), '4ee15000-0000-4000-8000-000000000aa1', '4ee15000-0000-4000-8000-0000000000c1', 'same', 'ru'),
  '42501', 'a patient cannot insert into session_check_ins directly');
select pg_temp.hs_expect_error(
  format('update public.session_check_ins set pain_after = 0 where id = %L', current_setting('heel_slide_test.ci1')),
  '42501', 'a patient cannot update session_check_ins directly');
select pg_temp.hs_expect_error(
  format('delete from public.session_check_ins where id = %L', current_setting('heel_slide_test.ci1')),
  '42501', 'a patient cannot delete from session_check_ins directly');

-- A second session of the same prescription: the completed one is not superseded, "none" alone is stripped, and a
-- note without "other" is dropped.
select set_config('heel_slide_test.s2', s.id::text, true)
from public.start_prescribed_session('4ee15000-0000-4000-8000-000000001001') s;
select pg_temp.hs_assert(
  (select status = 'completed' and not (summary ? 'ended_by')
   from public.sessions where id = current_setting('heel_slide_test.s1')::uuid),
  'starting the same prescription again leaves a completed session alone');
select public.finish_prescribed_session(current_setting('heel_slide_test.s2')::uuid, '{}'::jsonb);
select pg_temp.hs_assert(
  (select ci.symptoms = '{}'::text[] and ci.other_note is null and ci.language = 'kk'
   from public.submit_session_check_in(current_setting('heel_slide_test.s2')::uuid, 0, 0, 3, 'better',
          array['none'], 'should not be kept', 'kk') ci),
  '"none" alone stores no symptoms, and a note without "other" is not kept');

select pg_temp.hs_assert(
  (select count(*) from public.session_check_ins) = 2,
  'the patient reads their own check-ins through RLS');
select pg_temp.hs_assert(
  public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa1') is null
  and public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) is null,
  'the patient themselves gets null from the clinician RPCs');

-- ── Patient 1: a new start supersedes the session left in progress ─────────────────────────────────────────
select set_config('heel_slide_test.sa', s.id::text, true)
from public.start_prescribed_session('4ee15000-0000-4000-8000-000000001005') s;
-- The patient's client had written into it before they walked away (the sessions table policy allows that).
update public.sessions set summary = '{"note": "left the flow"}'::jsonb
 where id = current_setting('heel_slide_test.sa')::uuid;
select set_config('heel_slide_test.s3', s.id::text, true)
from public.start_prescribed_session('4ee15000-0000-4000-8000-000000001006') s;
select set_config('heel_slide_test.sb', s.id::text, true)
from public.start_prescribed_session('4ee15000-0000-4000-8000-000000001005') s;

select pg_temp.hs_assert(
  (select status = 'aborted' and ended_at = now()
      and summary = '{"note": "left the flow", "ended_by": "superseded_by_new_session"}'::jsonb
   from public.sessions where id = current_setting('heel_slide_test.sa')::uuid),
  'a new start aborts the caller''s in-progress session of the same prescription, keeping what its summary held');
select pg_temp.hs_assert(
  (select status = 'in_progress' from public.sessions where id = current_setting('heel_slide_test.sb')::uuid)
  and (select status = 'in_progress' and summary = '{}'::jsonb
       from public.sessions where id = current_setting('heel_slide_test.s3')::uuid)
  and (select count(*) from public.sessions
       where prescription_id = '4ee15000-0000-4000-8000-000000001005' and status = 'in_progress') = 1,
  'the new session is the only one in progress for its prescription; another prescription''s session is untouched');
select pg_temp.hs_expect_error(
  format('select public.finish_prescribed_session(%L::uuid, %L::jsonb)', current_setting('heel_slide_test.sa'), '{}'),
  '55000', 'an aborted session cannot be finished (55000)');

-- ── Patient 1: rows that arrive after the session ended ────────────────────────────────────────────────────
-- Every now() in this transaction is the same instant, so a session finished here has ended_at = now(): rows at
-- now() - n s were recorded while it was open; rows up to two minutes after it are still accepted (device clock
-- grace), later ones are skipped.
select pg_temp.hs_assert(
  (select (r ->> 'frames')::int = 1 and (r ->> 'skipped')::int = 0
   from (select public.flush_session_telemetry_batch(current_setting('heel_slide_test.sb')::uuid,
           jsonb_build_array(jsonb_build_object(
             'recorded_at', now() + interval '2 seconds', 'seq', 1, 'quality', null,
             'imu', jsonb_build_object('role', 'thigh', 'euler_deg', jsonb_build_array(0, 5, 0)))),
           '[]'::jsonb) as r) x),
  'an in-progress session accepts every frame, whatever its timestamp');

select public.finish_prescribed_session(current_setting('heel_slide_test.sb')::uuid, '{"kind": "heel_slide_path.v1"}'::jsonb);

select set_config('heel_slide_test.late', jsonb_build_array(
  jsonb_build_object('recorded_at', now() - interval '3 seconds', 'seq', 10, 'quality', null,
    'imu', jsonb_build_object('role', 'thigh', 'euler_deg', jsonb_build_array(0, 6, 0))),
  jsonb_build_object('recorded_at', now() - interval '1 second', 'seq', 11, 'quality', null,
    'imu', jsonb_build_object('role', 'thigh', 'euler_deg', jsonb_build_array(0, 7, 0))),
  jsonb_build_object('recorded_at', now() + interval '90 seconds', 'seq', 12, 'quality', null,
    'imu', jsonb_build_object('role', 'thigh', 'euler_deg', jsonb_build_array(0, 8, 0))),
  jsonb_build_object('recorded_at', now() + interval '3 minutes', 'seq', 13, 'quality', null,
    'imu', jsonb_build_object('role', 'thigh', 'euler_deg', jsonb_build_array(0, 9, 0)))
)::text, true);

select pg_temp.hs_assert(
  (select (r ->> 'frames')::int = 3 and (r ->> 'skipped')::int = 1
      and (r ->> 'events')::int = 1 and (r ->> 'skipped_events')::int = 1
   from (select public.flush_session_telemetry_batch(current_setting('heel_slide_test.sb')::uuid,
           current_setting('heel_slide_test.late')::jsonb,
           jsonb_build_array(
             jsonb_build_object('kind', 'episode', 'source', 'hs-test',
               'started_at', now() - interval '2 seconds', 'ended_at', now() - interval '1 second'),
             jsonb_build_object('kind', 'episode', 'source', 'hs-test',
               'started_at', now() + interval '3 minutes', 'ended_at', now() + interval '4 minutes'))) as r) x),
  'after a session ended, rows recorded before the end or within the two-minute grace are stored and later ones are skipped without an error');
select pg_temp.hs_assert(
  (select (r ->> 'frames')::int = 0 and (r ->> 'skipped')::int = 1
   from (select public.flush_session_telemetry_batch(current_setting('heel_slide_test.sb')::uuid,
           current_setting('heel_slide_test.late')::jsonb, '[]'::jsonb) as r) x),
  'late delivery stays idempotent: the resent batch stores nothing and skips the same rows');
select pg_temp.hs_assert(
  (select array_agg(seq order by seq) = array[1, 10, 11, 12]
   from public.session_frames where session_id = current_setting('heel_slide_test.sb')::uuid)
  and (select count(*) from public.fog_events where session_id = current_setting('heel_slide_test.sb')::uuid) = 1,
  'the ended session holds only the rows recorded while it was open or within the grace');
select pg_temp.hs_assert(
  (select (r ->> 'frames')::int = 1 and (r ->> 'skipped')::int = 1
   from (select public.flush_session_telemetry_batch(current_setting('heel_slide_test.sa')::uuid,
           jsonb_build_array(
             jsonb_build_object('recorded_at', now() - interval '1 second', 'seq', 20, 'quality', null,
               'imu', jsonb_build_object('role', 'foot')),
             jsonb_build_object('recorded_at', now() + interval '3 minutes', 'seq', 21, 'quality', null,
               'imu', jsonb_build_object('role', 'foot'))),
           '[]'::jsonb) as r) x),
  'the same cut-off applies to an aborted session');

-- ── Patient 1: repointed rows never reach another patient's program or prescription ───────────────────────
-- The table policies let a patient edit their own prescription and session rows, including these foreign keys.
update public.prescriptions set program_id = '4ee15000-0000-4000-8000-000000000f03'
 where id = '4ee15000-0000-4000-8000-000000001006';
select pg_temp.hs_assert(
  (select program_id = '4ee15000-0000-4000-8000-000000000f03'
   from public.prescriptions where id = '4ee15000-0000-4000-8000-000000001006'),
  'fixture: the patient repointed their own prescription at another patient''s active program');
select pg_temp.hs_expect_error(
  $q$select public.start_prescribed_session('4ee15000-0000-4000-8000-000000001006'::uuid)$q$,
  '55000', 'a prescription repointed at another patient''s active program cannot start a session');
select pg_temp.hs_assert(
  (select status = 'in_progress' from public.sessions where id = current_setting('heel_slide_test.s3')::uuid),
  'the refused start did not abort the session already open for that prescription');

update public.sessions set prescription_id = '4ee15000-0000-4000-8000-000000001004'
 where id = current_setting('heel_slide_test.s3')::uuid;
select pg_temp.hs_assert(
  (select prescription_id = '4ee15000-0000-4000-8000-000000001004'
   from public.sessions where id = current_setting('heel_slide_test.s3')::uuid),
  'fixture: the patient repointed their own session at another patient''s prescription');

-- ── Patient 2 ──────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000a2');
select pg_temp.hs_assert(
  (select count(*) from public.session_check_ins) = 0,
  'another patient cannot read patient 1''s check-ins');
select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 0, 0, 3, %L, null, null, %L)', current_setting('heel_slide_test.s1'), 'same', 'ru'),
  '42501', 'another patient cannot submit a check-in for patient 1''s session');
select pg_temp.hs_expect_error(
  format('select public.finish_prescribed_session(%L::uuid, %L::jsonb)', current_setting('heel_slide_test.s3'), '{}'),
  '42501', 'another patient cannot finish patient 1''s session');
select set_config('heel_slide_test.sp2', s.id::text, true)
from public.start_prescribed_session('4ee15000-0000-4000-8000-000000001004') s;

reset role;
select pg_temp.hs_assert(
  (select status = 'in_progress' from public.sessions where id = current_setting('heel_slide_test.s3')::uuid),
  'patient 2 starting their prescription does not abort patient 1''s session that points at it');
-- Every session in this transaction starts at now(); spread them out so "newest first" is observable:
-- s2, s1, s3, sb, sa.
update public.sessions s
   set started_at = s.started_at - o.back
  from (values
    (current_setting('heel_slide_test.s1')::uuid, interval '1 hour'),
    (current_setting('heel_slide_test.s3')::uuid, interval '2 hours'),
    (current_setting('heel_slide_test.sb')::uuid, interval '3 hours'),
    (current_setting('heel_slide_test.sa')::uuid, interval '4 hours')
  ) as o (id, back)
 where s.id = o.id;
set local role authenticated;

-- ── Reviewers who must see nothing ─────────────────────────────────────────────────────────────────────────
select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000b2');
select pg_temp.hs_assert(
  public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa1') is null
  and public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) is null
  and (select count(*) from public.session_check_ins) = 0,
  'a same-clinic clinician without a care-team link gets null and reads no check-ins');

select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000b3');
select pg_temp.hs_assert(
  public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa1') is null
  and public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) is null
  and (select count(*) from public.session_check_ins) = 0,
  'a clinician whose care-team link is inactive gets null and reads no check-ins');

select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000b4');
select pg_temp.hs_assert(
  public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa1') is null
  and public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) is null
  and (select count(*) from public.session_check_ins) = 0,
  'a deactivated clinician whose care-team link is still active gets null and reads no check-ins');

select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000d2');
select pg_temp.hs_assert(
  public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa1') is null
  and public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) is null
  and (select count(*) from public.session_check_ins) = 0,
  'another clinic''s clinic_admin gets null and reads no check-ins');

select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000f1');
select pg_temp.hs_assert(
  not app.is_admin()
  and public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa1') is null
  and public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) is null
  and (select count(*) from public.session_check_ins) = 0,
  'an account whose signup asked for admin is not an admin, gets null and reads no check-ins');

-- ── Linked clinician ───────────────────────────────────────────────────────────────────────────────────────
select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000b1');

select pg_temp.hs_assert(
  (select jsonb_array_length(l) = 5
      and l -> 0 ->> 'id' = current_setting('heel_slide_test.s2')
      and l -> 1 ->> 'id' = current_setting('heel_slide_test.s1')
      and l -> 2 ->> 'id' = current_setting('heel_slide_test.s3')
      and l -> 3 ->> 'id' = current_setting('heel_slide_test.sb')
      and l -> 4 ->> 'id' = current_setting('heel_slide_test.sa')
      and l -> 4 ->> 'status' = 'aborted'
      and l -> 1 ->> 'exercise_slug' = 'hs-test-exercise'
      and l -> 1 ->> 'exercise_name' = 'Heel slide test exercise'
      and l -> 1 ->> 'status' = 'completed'
      and (l -> 1 ->> 'has_check_in')::boolean
      and l -> 1 ? 'started_at' and l -> 1 ? 'ended_at'
   from public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa1') as l),
  'a linked clinician lists the patient''s sessions newest first with slug, name, status, has_check_in');

select pg_temp.hs_assert(
  public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa2') is null
  and public.clinician_session_result(current_setting('heel_slide_test.sp2')::uuid) is null
  and public.clinician_patient_sessions('4ee15000-0000-4000-8000-00000000dead') is null
  and public.clinician_session_result('4ee15000-0000-4000-8000-00000000dead') is null,
  'a linked clinician gets null for an unlinked patient and for unknown ids');

select pg_temp.hs_assert(
  (select r -> 'session' ->> 'id' = current_setting('heel_slide_test.s1')
      and r -> 'session' ->> 'status' = 'completed'
      and r -> 'session' -> 'device_info' ->> 'model_label' = 'WT901BLE68 (unverified)'
      and r -> 'session' -> 'summary' ->> 'kind' = 'heel_slide_path.v1'
      and r -> 'exercise' ->> 'slug' = 'hs-test-exercise'
      and r -> 'exercise' -> 'scoring_rubric' ->> 'min_valid_excursion_deg' = '22.5'
      and r -> 'exercise' -> 'default_dose' ->> 'reps' = '10'
      and r -> 'prescription' ->> 'id' = '4ee15000-0000-4000-8000-000000001001'
      and r -> 'prescription' -> 'dose' ->> 'reps' = '10'
      and r -> 'patient' ->> 'name' is not null
      and r -> 'check_in' ->> 'knee_feels' = 'same'
      and (r -> 'check_in' ->> 'pain_before')::int = 2
      and r -> 'check_in' -> 'symptoms' = '["swelling", "other"]'::jsonb
   from public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) as r),
  'a linked clinician gets the session, exercise config, dose, patient name and check-in');

select pg_temp.hs_assert(
  (select r -> 'frame_counts' = '{"thigh": 10, "shank": 11, "foot": 10}'::jsonb
      and jsonb_array_length(r -> 'frames' -> 'thigh') = 10
      and jsonb_array_length(r -> 'frames' -> 'shank') = 10
      and (r -> 'frames' ->> 'foot_count')::int = 10
      and (r -> 'frames' -> 'thigh' -> 0 ->> 1)::float8 = 170
      and (r -> 'frames' -> 'thigh' -> 9 ->> 1)::float8 = 179
      and (r -> 'frames' -> 'shank' -> 0 ->> 1)::float8 = -175
      and (r -> 'frames' -> 'thigh' -> 0 ->> 0)::float8 = extract(epoch from date_trunc('second', now())) * 1000
      and (r -> 'frames' -> 'thigh' -> 1 ->> 0)::float8 - (r -> 'frames' -> 'thigh' -> 0 ->> 0)::float8 = 20
   from public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) as r),
  'the result carries per-role [t_ms, pitch] series; a frame without pitch is counted but not charted');

select pg_temp.hs_assert(
  (select bool_and(prev is null or t >= prev)
   from (
     select (p ->> 0)::float8 as t, lag((p ->> 0)::float8) over (order by n) as prev
     from jsonb_array_elements(public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) -> 'frames' -> 'shank')
          with ordinality as e (p, n)
   ) ordered),
  'series points are in time order');

select pg_temp.hs_assert(
  (select r -> 'session' ->> 'prescription_id' = '4ee15000-0000-4000-8000-000000001004'
      and jsonb_typeof(r -> 'prescription') = 'null'
   from public.clinician_session_result(current_setting('heel_slide_test.s3')::uuid) as r),
  'the result shows no prescription when the session points at another patient''s');

select pg_temp.hs_assert(
  (select (r -> 'frame_counts' ->> 'thigh')::int = 4 and r -> 'session' ->> 'status' = 'completed'
   from public.clinician_session_result(current_setting('heel_slide_test.sb')::uuid) as r),
  'the result for a session with late deliveries counts only the frames it stored');

select pg_temp.hs_assert(
  (select r -> 'check_in' is not null and r -> 'check_in' <> 'null'::jsonb
   from public.clinician_session_result(current_setting('heel_slide_test.s2')::uuid) as r)
  and (select count(*) from public.session_check_ins) = 2,
  'a linked active clinician also reads the check-ins through RLS');

-- ── Clinic admin of the patient's clinic ───────────────────────────────────────────────────────────────────
select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000d1');
select pg_temp.hs_assert(
  jsonb_array_length(public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa1')) = 5
  and public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) is not null
  and (select count(*) from public.session_check_ins) = 2,
  'the patient''s clinic_admin gets the sessions, the result and the check-ins');

-- ── Report ─────────────────────────────────────────────────────────────────────────────────────────────────
reset role;
select pg_temp.hs_act_as(null);

select line
from (
  select format('ok %s - %s', n, name) as line, n
  from unnest(string_to_array(rtrim(current_setting('heel_slide_test.passed'), E'\n'), E'\n')) with ordinality as t (name, n)
  union all
  select format('1..%s', count(*)), 1000000
  from unnest(string_to_array(rtrim(current_setting('heel_slide_test.passed'), E'\n'), E'\n')) as t (name)
) report
order by n;

rollback;
