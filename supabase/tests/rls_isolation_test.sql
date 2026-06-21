-- rls_isolation_test.sql — pgTAP proof of the Phase-1 DoD: a patient and a clinician
-- exist and are isolated by RLS. Run with:  supabase test db
--
-- Strategy: build fixtures as the migration owner (RLS bypassed), then switch to the
-- `authenticated` role and forge request.jwt.claims to act as each user. auth.uid()
-- reads `sub` from the claim, so changing the claim changes the effective caller.

begin;
select plan(13);

-- ── Fixtures (as owner; RLS bypassed) ──────────────────────────────────────
insert into public.clinics (id, name, slug) values
  ('10000000-0000-0000-0000-000000000001', 'Clinic One', 'clinic-one'),
  ('10000000-0000-0000-0000-000000000002', 'Clinic Two', 'clinic-two');

-- Users (the on_auth_user_created trigger provisions profiles with the meta role).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'clin1@test.dev', 'x', now(), '{}'::jsonb, '{"role":"clinician"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'pa@test.dev',    'x', now(), '{}'::jsonb, '{"role":"patient"}'::jsonb,   now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-0000000000b1', 'authenticated', 'authenticated', 'pb@test.dev',    'x', now(), '{}'::jsonb, '{"role":"patient"}'::jsonb,   now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-0000000000c1', 'authenticated', 'authenticated', 'pc@test.dev',    'x', now(), '{}'::jsonb, '{"role":"patient"}'::jsonb,   now(), now());

update public.profiles set clinic_id = '10000000-0000-0000-0000-000000000001'
  where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-0000000000a1','20000000-0000-0000-0000-0000000000b1');
update public.profiles set clinic_id = '10000000-0000-0000-0000-000000000002'
  where id = '20000000-0000-0000-0000-0000000000c1';

insert into public.clinicians (id, profile_id, clinic_id) values
  ('c0000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');

-- Patient A and B in Clinic One; Patient C in Clinic Two.
insert into public.patients (id, profile_id, clinic_id) values
  ('a0000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-0000000000c1', '20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-000000000002');

-- The clinician is linked to A only (not B).
insert into public.care_team_links (clinic_id, clinician_id, patient_id) values
  ('10000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000a1');

-- One session each for A and B.
insert into public.sessions (id, patient_id, clinic_id, status) values
  ('50000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'completed'),
  ('50000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', 'completed');
insert into public.session_metrics (session_id, patient_id, clinic_id, reps) values
  ('50000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 10);
insert into public.fog_events (session_id, patient_id, clinic_id, started_at) values
  ('50000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', now());

-- A reference row (catalog), readable by any authenticated user.
insert into public.exercises (slug, name, modality) values ('t-ex', 'Test exercise', 'gait_balance');

-- ── Become `authenticated`; act as each user via the JWT claim ─────────────
set local role authenticated;

-- Patient A
select set_config('request.jwt.claims',
  json_build_object('sub','20000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
select is((select count(*) from public.sessions)::int, 1, 'patient A sees exactly one session (own)');
select is((select count(*) from public.sessions where patient_id = 'a0000000-0000-0000-0000-0000000000b1')::int, 0,
  'patient A cannot see patient B''s session');
select is((select count(*) from public.session_metrics)::int, 1, 'patient A sees own session_metrics');
select is((select count(*) from public.exercises)::int, 1, 'patient A can read the exercise catalog');
select is((select count(*) from public.audit_log)::int, 0, 'patient A cannot read the audit log');
select is((select count(*) from public.patients)::int, 1, 'patient A sees only their own patient row');

-- Patient B
select set_config('request.jwt.claims',
  json_build_object('sub','20000000-0000-0000-0000-0000000000b1','role','authenticated')::text, true);
select is((select count(*) from public.sessions)::int, 1, 'patient B sees exactly one session (own)');
select is((select count(*) from public.sessions where patient_id = 'a0000000-0000-0000-0000-0000000000a1')::int, 0,
  'patient B cannot see patient A''s session');

-- Clinician (linked to A only)
select set_config('request.jwt.claims',
  json_build_object('sub','20000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
select is((select count(*) from public.sessions)::int, 1, 'clinician sees exactly one session (linked patient A)');
select is((select count(*) from public.sessions where patient_id = 'a0000000-0000-0000-0000-0000000000a1')::int, 1,
  'clinician sees patient A''s session');
select is((select count(*) from public.sessions where patient_id = 'a0000000-0000-0000-0000-0000000000b1')::int, 0,
  'clinician cannot see unlinked patient B''s session');
select is((select count(*) from public.fog_events)::int, 1, 'clinician sees linked patient''s FoG events');

-- Patient C in another clinic sees none of Clinic One's data
select set_config('request.jwt.claims',
  json_build_object('sub','20000000-0000-0000-0000-0000000000c1','role','authenticated')::text, true);
select is((select count(*) from public.sessions)::int, 0, 'cross-clinic patient C sees no Clinic One sessions');

select * from finish();
rollback;
