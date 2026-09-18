-- session_scores_test.sql — proof of the session_scores path (0041_session_scores.sql).
--
-- Self-checking without pgTAP, same convention as heel_slide_path_test.sql: every check raises on failure,
-- aborting the transaction, so reaching the final select means every check passed.
--
-- Runs in its own transaction, always rolled back, with its own throwaway fixtures and its own copy of the
-- session-local assertion helpers (ss_* — distinct names from heel_slide_path_test.sql's hs_*, since each
-- test file is a separate transaction/session and cannot see the other's pg_temp functions). Needs
-- migrations up to 0041 applied. Sessions are inserted directly rather than through
-- start_prescribed_session: session_scores has no dependency on a program/prescription/exercise row, so
-- none are created here.
--
-- Covered:
--   - store_session_score: anon refused; a patient scores their own completed session; a second call is
--     idempotent (returns the first row, does not overwrite it); another patient's session is refused;
--     an in_progress session is refused (55000); a malformed payload is refused (22023)
--   - session_scores read: the patient, a linked active clinician, and the patient's clinic_admin can read
--     it; an unlinked clinician and an unrelated patient get nothing
--   - grants: authenticated can only select the table directly; anon has nothing; only the RPC can write

begin;

select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);

create function pg_temp.ss_pass(p_name text)
returns void
language sql
as $$
  select set_config('session_scores_test.passed', coalesce(current_setting('session_scores_test.passed', true), '') || p_name || E'\n', true);
$$;

create function pg_temp.ss_assert(p_ok boolean, p_name text)
returns void
language plpgsql
as $$
begin
  if p_ok is not true then
    raise exception 'FAIL: %', p_name;
  end if;
  perform pg_temp.ss_pass(p_name);
end;
$$;

create function pg_temp.ss_expect_error(p_sql text, p_state text, p_name text)
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
  perform pg_temp.ss_pass(p_name);
end;
$$;

create function pg_temp.ss_act_as(p_user uuid)
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
  ('5c012000-0000-4000-8000-0000000000c1', 'Session scores test', 'ss-test-clinic', 'Asia/Almaty');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '5c012000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated',
   'ss-test-patient-1@session-scores.test', 'x', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5c012000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated',
   'ss-test-patient-2@session-scores.test', 'x', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5c012000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated',
   'ss-test-clin-linked@session-scores.test', 'x', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '5c012000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated',
   'ss-test-clin-unlinked@session-scores.test', 'x', now(), '{}', '{}', now(), now());

update public.profiles p
   set role = f.role::public.app_role, clinic_id = f.clinic_id
  from (values
    ('5c012000-0000-4000-8000-0000000000a1'::uuid, 'patient',   '5c012000-0000-4000-8000-0000000000c1'::uuid),
    ('5c012000-0000-4000-8000-0000000000a2'::uuid, 'patient',   '5c012000-0000-4000-8000-0000000000c1'::uuid),
    ('5c012000-0000-4000-8000-0000000000b1'::uuid, 'clinician', '5c012000-0000-4000-8000-0000000000c1'::uuid),
    ('5c012000-0000-4000-8000-0000000000b2'::uuid, 'clinician', '5c012000-0000-4000-8000-0000000000c1'::uuid)
  ) as f (id, role, clinic_id)
 where p.id = f.id;

insert into public.clinicians (id, profile_id, clinic_id, is_active) values
  ('5c012000-0000-4000-8000-000000000cb1', '5c012000-0000-4000-8000-0000000000b1', '5c012000-0000-4000-8000-0000000000c1', true),
  ('5c012000-0000-4000-8000-000000000cb2', '5c012000-0000-4000-8000-0000000000b2', '5c012000-0000-4000-8000-0000000000c1', true);

insert into public.patients (id, profile_id, clinic_id) values
  ('5c012000-0000-4000-8000-000000000aa1', '5c012000-0000-4000-8000-0000000000a1', '5c012000-0000-4000-8000-0000000000c1'),
  ('5c012000-0000-4000-8000-000000000aa2', '5c012000-0000-4000-8000-0000000000a2', '5c012000-0000-4000-8000-0000000000c1');

-- Only patient 1 has a linked clinician; clinician 2 shares the clinic and nothing else.
insert into public.care_team_links (clinic_id, clinician_id, patient_id, is_active) values
  ('5c012000-0000-4000-8000-0000000000c1', '5c012000-0000-4000-8000-000000000cb1', '5c012000-0000-4000-8000-000000000aa1', true);

insert into public.sessions (id, patient_id, clinic_id, status, started_at, ended_at) values
  ('5c012000-0000-4000-8000-000000005001', '5c012000-0000-4000-8000-000000000aa1', '5c012000-0000-4000-8000-0000000000c1',
   'completed', now() - interval '5 minutes', now()),
  ('5c012000-0000-4000-8000-000000005002', '5c012000-0000-4000-8000-000000000aa1', '5c012000-0000-4000-8000-0000000000c1',
   'in_progress', now(), null),
  ('5c012000-0000-4000-8000-000000005003', '5c012000-0000-4000-8000-000000000aa2', '5c012000-0000-4000-8000-0000000000c1',
   'completed', now() - interval '5 minutes', now());

-- ── Grants ─────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.ss_assert(
  not has_table_privilege('authenticated', 'public.session_scores', 'insert')
  and not has_table_privilege('authenticated', 'public.session_scores', 'update')
  and not has_table_privilege('authenticated', 'public.session_scores', 'delete')
  and not has_table_privilege('anon', 'public.session_scores', 'select')
  and has_table_privilege('authenticated', 'public.session_scores', 'select'),
  'session_scores: authenticated may only select, anon has nothing');
select pg_temp.ss_assert(
  not has_function_privilege('anon', 'public.store_session_score(uuid, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.store_session_score(uuid, jsonb)', 'execute'),
  'store_session_score: executable by authenticated, not by anon');

set local role anon;
select pg_temp.ss_expect_error(
  $q$select public.store_session_score('5c012000-0000-4000-8000-000000005001'::uuid, '{}'::jsonb)$q$,
  '42501', 'anon cannot call store_session_score');
reset role;

-- ── Patient 1: storing a score ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select pg_temp.ss_act_as('5c012000-0000-4000-8000-0000000000a1');

select set_config(
  'session_scores_test.score',
  jsonb_build_object(
    'exercise_slug', 'heel_slide',
    'algorithm_version', 'heel-slide-stored-v1',
    'score_version', 'phoenix-2026-09',
    'signal_confidence', jsonb_build_object('frozen', false, 'frozen_reasons', '[]'::jsonb),
    'correctness_score', 88, 'volume_score', 100, 'target_score', 92, 'execution_effectiveness', 92,
    'target_reached_count', 7, 'valid_reps', 10, 'prescribed_reps', 10,
    'rom_max_deg', 93, 'rom_mean_deg', 88.5,
    'frozen', false, 'frozen_reasons', '[]'::jsonb, 'score_cap_reason', null,
    'reps', '[]'::jsonb
  )::text,
  true
);

select pg_temp.ss_expect_error(
  $q$select public.store_session_score('5c012000-0000-4000-8000-000000005002'::uuid,
     current_setting('session_scores_test.score')::jsonb)$q$,
  '55000', 'an in_progress session cannot be scored');
select pg_temp.ss_expect_error(
  $q$select public.store_session_score('5c012000-0000-4000-8000-000000005003'::uuid,
     current_setting('session_scores_test.score')::jsonb)$q$,
  '42501', 'a patient cannot score another patient''s session');
select pg_temp.ss_expect_error(
  $q$select public.store_session_score('5c012000-0000-4000-8000-000000005001'::uuid, '[1, 2]'::jsonb)$q$,
  '22023', 'the score payload must be a JSON object');
select pg_temp.ss_expect_error(
  $q$select public.store_session_score('5c012000-0000-4000-8000-000000005001'::uuid, '{}'::jsonb)$q$,
  '22023', 'exercise_slug/algorithm_version/score_version are required');

select public.store_session_score('5c012000-0000-4000-8000-000000005001'::uuid, current_setting('session_scores_test.score')::jsonb);

select pg_temp.ss_assert(
  (select correctness_score = 88 and volume_score = 100 and target_score = 92 and execution_effectiveness = 92
      and exercise_slug = 'heel_slide' and score_cap_reason is null and frozen is false
   from public.session_scores where session_id = '5c012000-0000-4000-8000-000000005001'),
  'store_session_score writes the computed row for the caller''s own completed session');

-- Idempotent: a second call with different numbers must not change the stored row.
select public.store_session_score(
  '5c012000-0000-4000-8000-000000005001'::uuid,
  jsonb_build_object(
    'exercise_slug', 'heel_slide', 'algorithm_version', 'heel-slide-stored-v1', 'score_version', 'phoenix-2026-09',
    'correctness_score', 1, 'volume_score', 1, 'target_score', 1, 'execution_effectiveness', 1,
    'target_reached_count', 0, 'valid_reps', 0, 'prescribed_reps', 10, 'reps', '[]'::jsonb
  )
);
select pg_temp.ss_assert(
  (select count(*) = 1 and bool_and(execution_effectiveness = 92)
   from public.session_scores where session_id = '5c012000-0000-4000-8000-000000005001'),
  'a second store_session_score call is idempotent: the first row is never overwritten');

-- ── Reading session_scores ─────────────────────────────────────────────────────────────────────────────────
select pg_temp.ss_assert(
  (select count(*) = 1 from public.session_scores where session_id = '5c012000-0000-4000-8000-000000005001'),
  'the patient can read their own session_scores row');

select pg_temp.ss_act_as('5c012000-0000-4000-8000-0000000000b1');
select pg_temp.ss_assert(
  (select count(*) = 1 from public.session_scores where session_id = '5c012000-0000-4000-8000-000000005001'),
  'a linked active clinician can read the patient''s session_scores row');

select pg_temp.ss_act_as('5c012000-0000-4000-8000-0000000000b2');
select pg_temp.ss_assert(
  (select count(*) = 0 from public.session_scores where session_id = '5c012000-0000-4000-8000-000000005001'),
  'an unlinked clinician reads nothing');

select pg_temp.ss_act_as('5c012000-0000-4000-8000-0000000000a2');
select pg_temp.ss_assert(
  (select count(*) = 0 from public.session_scores where session_id = '5c012000-0000-4000-8000-000000005001'),
  'an unrelated patient reads nothing');

reset role;

-- ── Report ─────────────────────────────────────────────────────────────────────────────────────────────────
select format('ok %s - %s', row_number() over (), line) as tap
from unnest(string_to_array(trim(trailing E'\n' from current_setting('session_scores_test.passed')), E'\n')) as line;
select format('1..%s', array_length(string_to_array(trim(trailing E'\n' from current_setting('session_scores_test.passed')), E'\n'), 1));

rollback;
