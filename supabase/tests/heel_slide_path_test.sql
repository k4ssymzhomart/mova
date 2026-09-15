-- heel_slide_path_test.sql — proof of the Heel Slide database path (0034_heel_slide_path.sql).
--
-- Self-checking without pgTAP (the hosted project does not have it): every check raises an exception on
-- failure, which aborts the transaction, so reaching the final select means every check passed. That select
-- prints one TAP line per check ("ok N - name", then "1..N"), so pg_prove-based runners read it as well.
--
-- Runs in one transaction that always ends in rollback. It builds its own throwaway clinics, users, patients,
-- clinicians, program and prescriptions, then impersonates each user with `set local role authenticated` and
-- request.jwt.claims (auth.uid() reads `sub` from the claim). It needs migrations up to 0034 applied, and does
-- not use the 'knee_flexion_extension' enum value, which cannot be used in the transaction that adds it.
--
-- Covered:
--   - a patient starts a session only from their own active prescription in an active program
--   - telemetry reaches session_frames through flush_session_telemetry_batch, idempotently
--   - check-in: refused before completion, every field validated, "none" stripped, note trimmed, idempotent
--   - no direct client writes to session_check_ins; anon cannot execute the new RPCs
--   - clinician reads: null for the patient, an unlinked or inactive-link clinician, another clinic's admin;
--     the full result for a linked clinician and for the patient's clinic_admin

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
   'hs-test-patient-1@heel-slide.test', 'x', now(), '{}', '{"role":"patient","full_name":"Test Patient One"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated',
   'hs-test-patient-2@heel-slide.test', 'x', now(), '{}', '{"role":"patient"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated',
   'hs-test-clin-linked@heel-slide.test', 'x', now(), '{}', '{"role":"clinician"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated',
   'hs-test-clin-unlinked@heel-slide.test', 'x', now(), '{}', '{"role":"clinician"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000b3', 'authenticated', 'authenticated',
   'hs-test-clin-inactive@heel-slide.test', 'x', now(), '{}', '{"role":"clinician"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000d1', 'authenticated', 'authenticated',
   'hs-test-admin-a@heel-slide.test', 'x', now(), '{}', '{"role":"clinic_admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '4ee15000-0000-4000-8000-0000000000d2', 'authenticated', 'authenticated',
   'hs-test-admin-b@heel-slide.test', 'x', now(), '{}', '{"role":"clinic_admin"}', now(), now());

-- The new-user trigger created the profiles; place everyone in clinic A except clinic B's admin.
update public.profiles set clinic_id = '4ee15000-0000-4000-8000-0000000000c1'
 where id in ('4ee15000-0000-4000-8000-0000000000a1', '4ee15000-0000-4000-8000-0000000000a2',
              '4ee15000-0000-4000-8000-0000000000b1', '4ee15000-0000-4000-8000-0000000000b2',
              '4ee15000-0000-4000-8000-0000000000b3', '4ee15000-0000-4000-8000-0000000000d1');
update public.profiles set clinic_id = '4ee15000-0000-4000-8000-0000000000c2'
 where id = '4ee15000-0000-4000-8000-0000000000d2';

insert into public.clinicians (id, profile_id, clinic_id) values
  ('4ee15000-0000-4000-8000-000000000cb1', '4ee15000-0000-4000-8000-0000000000b1', '4ee15000-0000-4000-8000-0000000000c1'),
  ('4ee15000-0000-4000-8000-000000000cb2', '4ee15000-0000-4000-8000-0000000000b2', '4ee15000-0000-4000-8000-0000000000c1'),
  ('4ee15000-0000-4000-8000-000000000cb3', '4ee15000-0000-4000-8000-0000000000b3', '4ee15000-0000-4000-8000-0000000000c1');

insert into public.patients (id, profile_id, clinic_id, affected_side) values
  ('4ee15000-0000-4000-8000-000000000aa1', '4ee15000-0000-4000-8000-0000000000a1', '4ee15000-0000-4000-8000-0000000000c1', 'right'),
  ('4ee15000-0000-4000-8000-000000000aa2', '4ee15000-0000-4000-8000-0000000000a2', '4ee15000-0000-4000-8000-0000000000c1', 'left');

-- Linked clinician: active link to patient 1. Inactive-link clinician: a link that was switched off.
-- The unlinked clinician shares the clinic and nothing else, which must not be enough.
insert into public.care_team_links (clinic_id, clinician_id, patient_id, is_active) values
  ('4ee15000-0000-4000-8000-0000000000c1', '4ee15000-0000-4000-8000-000000000cb1', '4ee15000-0000-4000-8000-000000000aa1', true),
  ('4ee15000-0000-4000-8000-0000000000c1', '4ee15000-0000-4000-8000-000000000cb3', '4ee15000-0000-4000-8000-000000000aa1', false);

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
   '4ee15000-0000-4000-8000-0000000000c1', '4ee15000-0000-4000-8000-0000000000e1', '{"reps": 10}', 'active', null);

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
  and not has_function_privilege('anon', 'public.submit_session_check_in(uuid, integer, integer, integer, text, text[], text, text)', 'execute')
  and not has_function_privilege('anon', 'public.clinician_patient_sessions(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.clinician_session_result(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.start_prescribed_session(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.submit_session_check_in(uuid, integer, integer, integer, text, text[], text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.clinician_patient_sessions(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.clinician_session_result(uuid)', 'execute'),
  'new RPCs: executable by authenticated, not by anon');

set local role anon;
select pg_temp.hs_expect_error(
  $q$select public.start_prescribed_session('4ee15000-0000-4000-8000-000000001001'::uuid, '{}'::jsonb)$q$,
  '42501', 'anon cannot call start_prescribed_session');
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
  (public.flush_session_telemetry_batch(current_setting('heel_slide_test.s1')::uuid,
     current_setting('heel_slide_test.frames')::jsonb, '[]'::jsonb) ->> 'frames')::int = 31,
  'flush_session_telemetry_batch stores 31 frames');
select pg_temp.hs_assert(
  (public.flush_session_telemetry_batch(current_setting('heel_slide_test.s1')::uuid,
     current_setting('heel_slide_test.frames')::jsonb, '[]'::jsonb) ->> 'frames')::int = 0,
  'resending the same batch stores nothing (idempotent on session_id, recorded_at, seq)');

select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 1, 1, 3, %L, null, null, %L)',
         current_setting('heel_slide_test.s1'), 'same', 'ru'),
  '55000', 'check-in is refused while the session is still in progress');

select pg_temp.hs_assert(
  (public.finish_training_session(current_setting('heel_slide_test.s1')::uuid,
     '{"kind": "heel_slide_path.v1", "reps_counted_on_device": 3}'::jsonb, '{}'::jsonb)).status = 'completed',
  'finish_training_session completes the session');

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

-- A second session: "none" alone is stripped, and a note without "other" is dropped.
select set_config('heel_slide_test.s2', s.id::text, true)
from public.start_prescribed_session('4ee15000-0000-4000-8000-000000001001') s;
select public.finish_training_session(current_setting('heel_slide_test.s2')::uuid, '{}'::jsonb, '{}'::jsonb);
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

-- ── Patient 2 ──────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000a2');
select pg_temp.hs_assert(
  (select count(*) from public.session_check_ins) = 0,
  'another patient cannot read patient 1''s check-ins');
select pg_temp.hs_expect_error(
  format('select public.submit_session_check_in(%L::uuid, 0, 0, 3, %L, null, null, %L)', current_setting('heel_slide_test.s1'), 'same', 'ru'),
  '42501', 'another patient cannot submit a check-in for patient 1''s session');
select set_config('heel_slide_test.sp2', s.id::text, true)
from public.start_prescribed_session('4ee15000-0000-4000-8000-000000001004') s;

reset role;
-- Every session in this transaction starts at now(); move the first one back so "newest first" is observable.
update public.sessions set started_at = started_at - interval '1 hour'
 where id = current_setting('heel_slide_test.s1')::uuid;
set local role authenticated;

-- ── Clinicians without a care-team link ────────────────────────────────────────────────────────────────────
select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000b2');
select pg_temp.hs_assert(
  public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa1') is null
  and public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) is null,
  'a same-clinic clinician without a care-team link gets null');

select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000b3');
select pg_temp.hs_assert(
  public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa1') is null
  and public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) is null,
  'a clinician whose care-team link is inactive gets null');

select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000d2');
select pg_temp.hs_assert(
  public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa1') is null
  and public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) is null,
  'another clinic''s clinic_admin gets null');

-- ── Linked clinician ───────────────────────────────────────────────────────────────────────────────────────
select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000b1');

select pg_temp.hs_assert(
  (select jsonb_array_length(l) = 2
      and l -> 0 ->> 'id' = current_setting('heel_slide_test.s2')
      and l -> 1 ->> 'id' = current_setting('heel_slide_test.s1')
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
  (select r -> 'check_in' is not null and r -> 'check_in' <> 'null'::jsonb
   from public.clinician_session_result(current_setting('heel_slide_test.s2')::uuid) as r)
  and (select count(*) from public.session_check_ins) = 2,
  'a linked clinician also reads the check-ins through RLS');

-- ── Clinic admin of the patient's clinic ───────────────────────────────────────────────────────────────────
select pg_temp.hs_act_as('4ee15000-0000-4000-8000-0000000000d1');
select pg_temp.hs_assert(
  jsonb_array_length(public.clinician_patient_sessions('4ee15000-0000-4000-8000-000000000aa1')) = 2
  and public.clinician_session_result(current_setting('heel_slide_test.s1')::uuid) is not null,
  'the patient''s clinic_admin gets the sessions and the result');

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
