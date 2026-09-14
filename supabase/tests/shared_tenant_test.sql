-- shared_tenant_test.sql — proves the 0023/0024 tenancy fix: self-serve signups no
-- longer share one clinic, signup metadata cannot self-assign a privileged role, and
-- the clinician-portal RPCs authorize by role + care_team_links, not raw clinic_id
-- equality. Run with:  supabase test db

begin;
select plan(7);

-- ── Fixtures (as owner; RLS bypassed) ──────────────────────────────────────

-- A real multi-patient clinic: a clinic_admin, a clinician linked to patient D only,
-- and two patients (D, E).
insert into public.clinics (id, name, slug) values
  ('30000000-0000-0000-0000-000000000001', 'Shared Tenant Test Clinic', 'shared-tenant-test-clinic');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'stt-admin@test.dev', 'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'stt-clin@test.dev',  'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'stt-pd@test.dev',    'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-0000000000e1', 'authenticated', 'authenticated', 'stt-pe@test.dev',    'x', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

-- Route these accounts into the real clinic and assign real roles (the trigger
-- provisions everyone as a plain patient in their own personal clinic; an admin
-- reassigns role/clinic_id out of band, same as production onboarding).
update public.profiles set role = 'clinic_admin', clinic_id = '30000000-0000-0000-0000-000000000001'
  where id = '40000000-0000-0000-0000-000000000001';
update public.profiles set role = 'clinician', clinic_id = '30000000-0000-0000-0000-000000000001'
  where id = '40000000-0000-0000-0000-000000000002';
update public.profiles set clinic_id = '30000000-0000-0000-0000-000000000001'
  where id in ('40000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-0000000000e1');

insert into public.clinicians (id, profile_id, clinic_id) values
  ('c0000000-0000-0000-0000-0000000000f2', '40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001');

insert into public.patients (id, profile_id, clinic_id) values
  ('a0000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-0000000000e1', '40000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-000000000001');

-- The clinician is linked to patient D only.
insert into public.care_team_links (clinic_id, clinician_id, patient_id) values
  ('30000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000d1');

-- Two independent self-serve signups, plus one that tries to self-assign a
-- privileged role via signup metadata.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-0000000000f1', 'authenticated', 'authenticated', 'stt-self1@test.dev',    'x', now(), '{}'::jsonb, '{}'::jsonb,                      now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-0000000000f2', 'authenticated', 'authenticated', 'stt-self2@test.dev',    'x', now(), '{}'::jsonb, '{}'::jsonb,                      now(), now()),
  ('00000000-0000-0000-0000-000000000000', '40000000-0000-0000-0000-0000000000f3', 'authenticated', 'authenticated', 'stt-attacker@test.dev', 'x', now(), '{}'::jsonb, '{"role":"clinic_admin"}'::jsonb, now(), now());

select isnt(
  (select clinic_id from public.profiles where id = '40000000-0000-0000-0000-0000000000f1'),
  (select clinic_id from public.profiles where id = '40000000-0000-0000-0000-0000000000f2'),
  'two self-serve signups land in two different personal clinics'
);

select is(
  (select role from public.profiles where id = '40000000-0000-0000-0000-0000000000f3')::text,
  'patient',
  'signup metadata cannot self-assign role=clinic_admin'
);

-- ── Become `authenticated`; act as each user via the JWT claim ─────────────
set local role authenticated;

-- A plain self-serve patient has no clinical role, so the portal RPC sees nothing --
-- the old bug let a shared-tenant member see everyone via this exact call.
select set_config('request.jwt.claims',
  json_build_object('sub', '40000000-0000-0000-0000-0000000000f1', 'role', 'authenticated')::text, true);
select is(public.clinic_caseload(), '[]'::jsonb, 'a plain self-serve patient sees an empty caseload');

-- Clinician linked to D only.
select set_config('request.jwt.claims',
  json_build_object('sub', '40000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select is(jsonb_array_length(public.clinic_caseload()), 1, 'clinician sees exactly one linked patient');
select is(
  (public.clinic_caseload() -> 0 ->> 'patient_id')::uuid,
  'a0000000-0000-0000-0000-0000000000d1'::uuid,
  'clinician sees patient D (linked), not E'
);
select is(
  public.clinic_patient_overview('a0000000-0000-0000-0000-0000000000e1'::uuid),
  null,
  'clinician cannot fetch overview of unlinked patient E'
);

-- clinic_admin sees the whole clinic (D and E).
select set_config('request.jwt.claims',
  json_build_object('sub', '40000000-0000-0000-0000-000000000001', 'role', 'authenticated')::text, true);
select is(jsonb_array_length(public.clinic_caseload()), 2, 'clinic_admin sees the whole clinic roster');

select * from finish();
rollback;
