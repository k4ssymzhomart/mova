-- seed.sql — runs on `supabase db reset`.
-- Reference catalogs + one demo clinic with a clinician and a patient so the app has
-- real data and the Phase-1 DoD ("a patient + clinician, isolated by RLS") is demoable.
-- Demo password for every account below: Mova-Demo-1234
--
-- NOTE: the auth.users/auth.identities column set follows the current Supabase local
-- schema. If your Supabase version differs, adjust the demo-account block only — the
-- reference catalogs above it are plain public-schema inserts and always apply.

-- ============================================================================
-- Reference catalogs (no auth dependency)
-- ============================================================================
insert into public.conditions (id, slug, name, description, default_modality, icd10) values
  ('c0000000-0000-0000-0000-000000000001', 'stroke',     'Stroke (CVA)',        'Upper-limb hemiparesis rehab.', 'upper_limb_reaching', 'I63'),
  ('c0000000-0000-0000-0000-000000000002', 'parkinsons', 'Parkinson''s disease','Gait + freezing-of-gait rehab.', 'gait_balance',        'G20'),
  ('c0000000-0000-0000-0000-000000000003', 'acl_post_op','ACL reconstruction',  'Knee ROM + lower-limb rehab.',  'sit_to_stand_lower_limb', 'S83.5')
on conflict (id) do nothing;

insert into public.exercise_packs (id, slug, title, modality, description) values
  ('e0000000-0000-0000-0000-0000000000a1', 'upper-limb-reaching', 'Upper-limb reaching', 'upper_limb_reaching', 'Reach-to-target tasks; richest CV evidence.'),
  ('e0000000-0000-0000-0000-0000000000a2', 'gait-balance',        'Gait & balance',      'gait_balance',        'Gait + balance tasks; pairs with the FoG model.')
on conflict (id) do nothing;

insert into public.exercises (id, pack_id, slug, name, modality, target_joints, difficulty, description) values
  ('e0000000-0000-0000-0000-0000000000b1', 'e0000000-0000-0000-0000-0000000000a1', 'reach-to-target', 'Reach to target', 'upper_limb_reaching', array['r_upperarm','r_wrist']::public.body_site[], 'easy',     'Reach to on-screen targets; tracks shoulder/elbow ROM + smoothness.'),
  ('e0000000-0000-0000-0000-0000000000b2', 'e0000000-0000-0000-0000-0000000000a2', 'tandem-stand',    'Tandem stand',    'gait_balance',        array['pelvis','l_shank','r_shank']::public.body_site[], 'moderate', 'Balance hold with sway feedback; FoG-aware.')
on conflict (id) do nothing;

insert into public.achievement_defs (code, title, description, xp_reward) values
  ('first_session',  'First session',  'Completed your first rehab session.', 50),
  ('streak_7',       '7-day streak',   'Trained 7 days in a row.',            100),
  ('rom_goal_met',   'ROM goal',       'Reached a range-of-motion goal.',     150)
on conflict (code) do nothing;

insert into public.citations (cite_key, entry_type, title, authors, year, venue, url) values
  ('xu2025fog', 'article', 'Towards Generalizable Human Activity Recognition', 'Xu et al.', 2025, 'arXiv', 'https://arxiv.org/abs/2508.12213'),
  ('bachlin2010fog', 'article', 'Wearable Assistant for Parkinson''s Disease Patients With the Freezing of Gait Symptom', 'Bachlin et al.', 2010, 'IEEE TITB', 'https://ieeexplore.ieee.org/document/5325884')
on conflict (cite_key) do nothing;

-- Model + the honest FoG baseline (Part 1.4.2). Do NOT present as a success.
insert into public.model_registry (id, name, version, task, framework, status, metrics, notes) values
  ('d0000000-0000-0000-0000-000000000001', 'mova-fog', 'v0.1-baseline', 'fog', 'torch', 'staging',
   '{"accuracy":0.678,"balanced_acc":0.527,"macro_f1":0.525,"sensitivity":0.210,"specificity":0.845,"precision":0.325,"auroc":0.551}'::jsonb,
   'From-scratch, 12-epoch, single held-out subject (S08). Near-chance AUROC; the program exists to beat this.')
on conflict (id) do nothing;

insert into public.benchmark_runs (model_id, task, dataset, split, protocol, metrics, is_baseline, notes) values
  ('d0000000-0000-0000-0000-000000000001', 'fog', 'Daphnet-FoG', 'S08', 'subject-disjoint',
   '{"accuracy":0.678,"balanced_acc":0.527,"macro_f1":0.525,"sensitivity":0.210,"specificity":0.845,"precision":0.325,"auroc":0.551,"confusion":{"tn":1447,"fp":266,"fn":481,"tp":128}}'::jsonb,
   true, 'Freeze-stratified, subject-disjoint. Honest baseline; misses ~79% of freezes.')
on conflict do nothing;

insert into public.content (slug, kind, title, summary, status, published_at) values
  ('model-mova-fog', 'model_card', 'MOVA-FoG v0.1 (baseline)', 'Honest from-scratch FoG baseline and the path to thesis-grade results.', 'published', now()),
  ('dataset-daphnet', 'dataset_card', 'Daphnet Freezing-of-Gait', 'Ankle/thigh/trunk accelerometry labeled for FoG; accelerometer-only.', 'published', now())
on conflict (slug) do nothing;

-- Demo clinic
insert into public.clinics (id, name, slug, timezone) values
  ('11111111-1111-1111-1111-111111111111', 'MOVA Demo Clinic', 'mova-demo', 'Asia/Almaty')
on conflict (id) do nothing;

-- ============================================================================
-- Demo accounts (auth.users -> handle_new_user trigger creates profiles)
-- ============================================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'clinician@mova.dev', extensions.crypt('Mova-Demo-1234', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Dr. Dana Park","role":"clinician"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated',
   'patient@mova.dev', extensions.crypt('Mova-Demo-1234', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Alex Patient","role":"patient"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated',
   'admin@mova.dev', extensions.crypt('Mova-Demo-1234', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Casey Admin","role":"clinic_admin"}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values
  ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
   '{"sub":"22222222-2222-2222-2222-222222222222","email":"clinician@mova.dev"}'::jsonb, 'email', now(), now(), now()),
  ('33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333',
   '{"sub":"33333333-3333-3333-3333-333333333333","email":"patient@mova.dev"}'::jsonb, 'email', now(), now(), now()),
  ('44444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444',
   '{"sub":"44444444-4444-4444-4444-444444444444","email":"admin@mova.dev"}'::jsonb, 'email', now(), now(), now())
on conflict (provider_id, provider) do nothing;

-- Bind profiles to the clinic (trigger already set role + full_name).
update public.profiles set clinic_id = '11111111-1111-1111-1111-111111111111', timezone = 'Asia/Almaty'
where id in (
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);

-- Role records
insert into public.clinicians (id, profile_id, clinic_id, title, specialties) values
  ('c1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'PT', array['neuro','stroke'])
on conflict (id) do nothing;

insert into public.patients (id, profile_id, clinic_id, mrn, affected_side, primary_condition_id) values
  ('a1111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'MRN-0001', 'right', 'c0000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.care_team_links (clinic_id, clinician_id, patient_id, relationship) values
  ('11111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'primary')
on conflict (clinician_id, patient_id) do nothing;

-- A program + prescription + one completed session with metrics + a FoG event
insert into public.programs (id, patient_id, clinic_id, title, created_by) values
  ('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Right upper-limb recovery', 'c1111111-1111-1111-1111-111111111111')
on conflict (id) do nothing;

insert into public.prescriptions (id, program_id, patient_id, clinic_id, exercise_id, difficulty, frequency_per_week, prescribed_by) values
  ('b2111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-0000000000b1', 'easy', 5, 'c1111111-1111-1111-1111-111111111111')
on conflict (id) do nothing;

insert into public.sessions (id, patient_id, clinic_id, program_id, prescription_id, exercise_id, status, started_at, ended_at) values
  ('5e551011-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 'b2111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-0000000000b1', 'completed', now() - interval '1 day', now() - interval '1 day' + interval '12 minutes')
on conflict (id) do nothing;

insert into public.session_metrics (session_id, patient_id, clinic_id, reps, rom_max, rom_mean, smoothness, symmetry, quality_score, adherence, fog_risk) values
  ('5e551011-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 24, 118.4, 96.2, 0.71, 0.83, 0.78, 0.92, 0.12)
on conflict (session_id) do nothing;

insert into public.fog_events (session_id, patient_id, clinic_id, kind, started_at, ended_at, confidence, freeze_index, source) values
  ('5e551011-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'episode', now() - interval '1 day' + interval '4 minutes', now() - interval '1 day' + interval '4 minutes 6 seconds', 0.61, 2.4, 'mock-bachlin-freeze-index')
on conflict do nothing;

insert into public.streaks (patient_id, clinic_id, current_streak, longest_streak, last_active_date) values
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 3, 7, current_date)
on conflict (patient_id) do nothing;

insert into public.achievements (patient_id, clinic_id, def_code) values
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'first_session')
on conflict (patient_id, def_code) do nothing;
