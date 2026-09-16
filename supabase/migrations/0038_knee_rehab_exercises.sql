-- 0038_knee_rehab_exercises.sql (0026 on feature/exercise-screen-rebuild; renumbered past the applied 0036, not applied)
-- Before applying: production already has the Heel Slide exercise under slug 'heel-slide' (seed-heel-slide.mjs,
-- with its prescription); this file inserts 'heel_slide', so applying it as-is creates a second Heel Slide row.
-- Seeds the 8 knee-rehab exercises (docs/PHOENIX_8_Exercises_Targets (1).docx) into the real exercise
-- catalog. Without this, start_training_session(p_exercise_slug) has nothing to resolve these slugs to —
-- lib/scoring/exerciseConfigs.ts defines the SCORING side of these 8 exercises, but the catalog itself
-- (what /exercises lists, what a prescription can reference) had no matching rows at all until now.
-- Slugs here must stay byte-for-byte in sync with ExerciseSlug in lib/scoring/types.ts.

insert into public.exercise_packs (id, slug, title, modality, description) values
  ('e0000000-0000-0000-0000-0000000000a3', 'knee-rehab', 'Knee rehabilitation',
   'sit_to_stand_lower_limb', 'Post-op / conservative knee ROM and strength progressions, BLE-sensor scored.')
on conflict (id) do nothing;

insert into public.exercises (pack_id, slug, name, modality, target_joints, difficulty, description) values
  ('e0000000-0000-0000-0000-0000000000a3', 'heel_slide', 'Heel Slide', 'sit_to_stand_lower_limb',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[], 'easy',
   'Slide the heel toward the hips, bending the knee, then return with control.'),
  ('e0000000-0000-0000-0000-0000000000a3', 'seated_knee_flexion', 'Seated Knee Flexion', 'sit_to_stand_lower_limb',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[], 'easy',
   'Seated, bend the knee under the chair and hold briefly before returning.'),
  ('e0000000-0000-0000-0000-0000000000a3', 'prone_knee_bend', 'Prone Knee Bend', 'sit_to_stand_lower_limb',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[], 'moderate',
   'Lying face down, bend the knee, then lower it back with control.'),
  ('e0000000-0000-0000-0000-0000000000a3', 'short_arc_quad', 'Short Arc Quad', 'sit_to_stand_lower_limb',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[], 'easy',
   'With the leg resting on a bolster, straighten the knee, hold, then lower.'),
  ('e0000000-0000-0000-0000-0000000000a3', 'straight_leg_raise', 'Straight Leg Raise', 'sit_to_stand_lower_limb',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[], 'moderate',
   'Lying down with the leg straight, raise the whole leg, hold, then lower.'),
  ('e0000000-0000-0000-0000-0000000000a3', 'ankle_pumps', 'Ankle Pumps', 'sit_to_stand_lower_limb',
   array['l_shank','r_shank','l_foot','r_foot']::public.body_site[], 'intro',
   'Point and flex the foot through a full comfortable range, cycling steadily.'),
  ('e0000000-0000-0000-0000-0000000000a3', 'mini_squat', 'Mini Squat', 'sit_to_stand_lower_limb',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[], 'moderate',
   'Standing, bend both knees to a shallow squat within the target band, then rise.'),
  ('e0000000-0000-0000-0000-0000000000a3', 'quad_set', 'Quad Set', 'sit_to_stand_lower_limb',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[], 'intro',
   'Tighten the thigh muscle to hold the leg still and straight for a set duration.')
on conflict (slug) do update set
  pack_id      = excluded.pack_id,
  name         = excluded.name,
  modality     = excluded.modality,
  target_joints = excluded.target_joints,
  difficulty   = excluded.difficulty,
  description  = excluded.description;
