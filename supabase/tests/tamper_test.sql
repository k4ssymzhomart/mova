-- tamper_test.sql — proves 0025 (write lockdown), 0026 (column immutability), and
-- 0027 (server-derived session metrics) actually stop a patient's own browser from
-- forging clinical/gamification data. Run with:  supabase test db

begin;
select plan(7);

-- ── Fixtures (as owner; RLS bypassed) ──────────────────────────────────────
insert into public.clinics (id, name, slug) values
  ('60000000-0000-0000-0000-000000000001', 'Tamper Test Clinic One', 'tamper-test-clinic-one'),
  ('60000000-0000-0000-0000-000000000002', 'Tamper Test Clinic Two', 'tamper-test-clinic-two');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '70000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'tamperer@test.dev', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

update public.profiles set clinic_id = '60000000-0000-0000-0000-000000000001'
  where id = '70000000-0000-0000-0000-0000000000a1';

insert into public.patients (id, profile_id, clinic_id) values
  ('a0000000-0000-0000-0000-0000000000ff', '70000000-0000-0000-0000-0000000000a1', '60000000-0000-0000-0000-000000000001');

insert into public.sessions (id, patient_id, clinic_id, status) values
  ('80000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000ff', '60000000-0000-0000-0000-000000000001', 'in_progress');

-- A couple of real telemetry frames -- nowhere near enough to legitimately produce
-- 190 reps or a perfect quality score.
insert into public.session_frames (session_id, patient_id, clinic_id, recorded_at, seq, joint_angles) values
  ('80000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000ff', '60000000-0000-0000-0000-000000000001', now(), 1, '{"knee": 90}'::jsonb),
  ('80000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000ff', '60000000-0000-0000-0000-000000000001', now() + interval '1 second', 2, '{"knee": 30}'::jsonb);

-- ── Become `authenticated`; act as the patient via the JWT claim ───────────
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '70000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);

-- 1. A patient cannot rewrite their own tenant key (0026).
select throws_ok(
  $sql$update public.patients set clinic_id = '60000000-0000-0000-0000-000000000002' where id = 'a0000000-0000-0000-0000-0000000000ff'$sql$,
  '23514',
  'a patient cannot change their own patients.clinic_id'
);

-- 2. Direct writes to the gamification/clinical tables are denied -- only the
-- SECURITY DEFINER RPCs may write them (0025).
select throws_ok(
  $sql$insert into public.xp_ledger (patient_id, clinic_id, delta) values ('a0000000-0000-0000-0000-0000000000ff', '60000000-0000-0000-0000-000000000001', 999999)$sql$,
  '42501',
  'a patient cannot INSERT xp_ledger directly'
);
select throws_ok(
  $sql$update public.streaks set current_streak = 999 where patient_id = 'a0000000-0000-0000-0000-0000000000ff'$sql$,
  '42501',
  'a patient cannot UPDATE streaks directly'
);
select throws_ok(
  $sql$delete from public.rom_measurements where patient_id = 'a0000000-0000-0000-0000-0000000000ff'$sql$,
  '42501',
  'a patient cannot DELETE rom_measurements directly'
);
select throws_ok(
  $sql$update public.session_metrics set quality_score = 1 where patient_id = 'a0000000-0000-0000-0000-0000000000ff'$sql$,
  '42501',
  'a patient cannot UPDATE session_metrics directly'
);

-- 3. finish_training_session derives metrics server-side from session_frames; a
-- forged client payload cannot inflate reps or fabricate a quality score (0027).
select public.finish_training_session(
  '80000000-0000-0000-0000-0000000000a1'::uuid,
  '{}'::jsonb,
  '{"reps": 190, "quality_score": 1, "adherence": 1}'::jsonb
);

select ok(
  (select reps from public.session_metrics where session_id = '80000000-0000-0000-0000-0000000000a1') < 190,
  'forged client reps claim is not trusted -- derived reps stays far below the forged value'
);
select is(
  (select quality_score from public.session_metrics where session_id = '80000000-0000-0000-0000-0000000000a1'),
  null,
  'quality_score is never populated from client input'
);

select * from finish();
rollback;
