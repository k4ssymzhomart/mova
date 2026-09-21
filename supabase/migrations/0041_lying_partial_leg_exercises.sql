-- 0041_lying_partial_leg_exercises.sql (not applied)
-- The two Phoenix exercises mova's catalog was missing: the partial lying leg raise and its hold
-- variant. Sources: services/imu-tools/src/mova_imu/analysis/exercise_signals.py (both keyed on the
-- ABSOLUTE thigh pitch, enter_deg 8.0, exit_deg 4.0) and execution_score.py (elevation_target_deg 15.0
-- for both; a 3 s hold target for the hold variant and nothing else calibrated for either). The
-- patient-facing and scoring sides are already in the app:
-- services/frontend/src/lib/exercises/catalog.ts and src/lib/scoring/exerciseConfigs.ts. These rows are
-- what a prescription can point at and what start_training_session(p_exercise_slug) resolves
-- (0017_self_serve.sql:111) and what the session flow loads (src/app/(app)/app/session/_flow/load.ts).
--
-- SLUGS ARE KEBAB-CASE, matching catalog.ts and the production 'heel-slide' row. They are deliberately
-- NOT the snake_case ExerciseSlug values: 0038 inserts 'heel_slide' beside production's 'heel-slide'
-- and its own header warns that applying it as-is creates a second Heel Slide. Do not apply 0038.
--
-- Depends on nothing after 0036. In particular it does NOT touch exercises.demo_video_url, which
-- arrives in the still-unapplied 0039; the clinician reference clip for an exercise is read from
-- catalog.ts, and for these two exercises there is none at all (catalog.ts has video: null for both,
-- because no clip of either was ever recorded).
--
-- WHAT IS NOT SOURCED, said plainly rather than dressed up:
--   * `difficulty` is not null and the enum has no 'unspecified' value, so both rows carry the column
--     default 'easy'. That is a placeholder, not a clinical grading.
--   * `modality` is not null either; 'knee_flexion_extension' (added by the applied 0034) is the
--     closest value the enum has for a lying leg raise, which is a hip movement watched on the thigh.
--   * `approval_state` in the rubric stays 'draft'. These are Phoenix's engineering numbers. Nobody
--     has approved them for mova, and for the raise every correctness target upstream is None.
--
-- The rubric follows the shape scripts/seed-heel-slide.mjs already writes, so lib/motion/reps.ts
-- heelSlideThresholds (which reads only min_valid_excursion_deg) keeps working against these rows.
--
-- ON CONFLICT DO NOTHING rather than an upsert: 0037-0040 are unapplied and the apply order is
-- uncertain, so this file has to be safe to run twice, and a second run must never overwrite a value a
-- clinician edited in between. Neither slug exists on the hosted project today, so the first apply is
-- the one that inserts them.

-- The knee-rehab pack, with the same id and shape 0038 uses, so the two files cannot fight over it.
insert into public.exercise_packs (id, slug, title, modality, description) values
  ('e0000000-0000-0000-0000-0000000000a3', 'knee-rehab', 'Knee rehabilitation',
   'sit_to_stand_lower_limb', 'Post-op / conservative knee ROM and strength progressions, BLE-sensor scored.')
on conflict (id) do nothing;

insert into public.exercises
  (pack_id, slug, name, modality, target_joints, difficulty, description, instructions,
   default_dose, scoring_rubric, is_published)
values
  ('e0000000-0000-0000-0000-0000000000a3',
   'lying-partial-leg-raise',
   'Частичный подъём ноги лёжа',
   'knee_flexion_extension',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[],
   'easy',
   null,
   'Лёжа на спине, слегка поднимите прямую ногу над опорой. Поднимайте невысоко и плавно, не рывком. Опускайте ногу медленно, не бросайте её.',
   '{"reps": 10}'::jsonb,
   jsonb_build_object(
     'schema', 'exercise_config/phoenix_profile.v1',
     'approval_state', 'draft',
     'phoenix_id', 'exercise-lying-partial-leg-raise-v1',
     'scoring_slug', 'lying_partial_leg_raise',
     'target', jsonb_build_object('type', 'AT_LEAST', 'metric', 'thigh_elevation_deg', 'value', 15),
     'min_valid_excursion_deg', 8,
     'reps', 10,
     'sensors', jsonb_build_array('thigh', 'shank'),
     'note', 'Phoenix execution_score.py: elevation target 15 deg on the THIGH, not a knee angle. Every tempo, lowering and smoothness target upstream is None, so those components abstain rather than score. Engineering config, not clinically approved.'
   ),
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'lying-partial-leg-hold',
   'Частичный подъём ноги лёжа с удержанием',
   'knee_flexion_extension',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[],
   'easy',
   null,
   'Лёжа на спине, слегка поднимите прямую ногу над опорой. Задержитесь в верхней точке примерно на 3 секунды. Опускайте ногу медленно, не бросайте её.',
   '{"reps": 10, "hold_seconds": 3}'::jsonb,
   jsonb_build_object(
     'schema', 'exercise_config/phoenix_profile.v1',
     'approval_state', 'draft',
     'phoenix_id', 'exercise-lying-partial-leg-hold-v1',
     'scoring_slug', 'lying_partial_leg_hold',
     'target', jsonb_build_object('type', 'AT_LEAST', 'metric', 'thigh_elevation_deg', 'value', 15),
     'hold_target_seconds', 3,
     'min_valid_excursion_deg', 8,
     'reps', 10,
     'sensors', jsonb_build_array('thigh', 'shank'),
     'note', 'Phoenix execution_score.py: elevation target 15 deg on the THIGH, plus a 3 s hold — the hold is the only calibrated target of the two lying partial raises. Engineering config, not clinically approved.'
   ),
   true)
on conflict (slug) do nothing;
