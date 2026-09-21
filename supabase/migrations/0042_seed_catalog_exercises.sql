-- 0042_seed_catalog_exercises.sql (not applied)
-- The rest of the exercise library, so the session flow has something to resolve.
--
-- WHY THIS EXISTS. services/frontend/src/lib/exercises/catalog.ts is the source of truth for
-- everything the patient READS (/exercises renders EXERCISE_CATALOG directly), but the session flow
-- resolves the prescribed exercise through the DATABASE instead: src/app/(app)/app/session/_flow/
-- load.ts:152 selects exercise:exercises(name, slug, scoring_rubric, default_dose). Nothing syncs one
-- to the other. The catalog describes nineteen exercises and public.exercises holds at most three rows
-- on the hosted project — 'heel-slide' (written by services/frontend/scripts/seed-heel-slide.mjs, not
-- by a migration) and the two Phase-1 camera-era demo rows from supabase/seed.sql. So a generic
-- session screen finds nothing to run for sixteen of nineteen entries. 0041 adds the two new ones;
-- this file adds the other sixteen.
--
-- Slugs are the KEBAB-CASE catalog slugs. Never the snake_case scoring slugs: slug is citext UNIQUE
-- with no CHECK, so 'heel-slide' and 'heel_slide' happily coexist as two different exercises, which is
-- exactly the mess 0038 would create and why it stays unapplied.
--
-- 'heel-slide' IS DELIBERATELY NOT IN THIS FILE. That row already exists in production with
-- is_published false and a rubric the seed script wrote; rewriting it from here would change a row
-- real patients are prescribed. If it should be published, that is its own one-line change and its own
-- decision.
--
-- ON CONFLICT (slug) DO NOTHING, not an upsert: 0037-0040 are unapplied and the apply order is
-- uncertain, so this must be safe to run twice, and a re-run must never overwrite an edit a clinician
-- made in between. Every row here is new.
--
-- Depends on nothing after 0034 (which added the 'knee_flexion_extension' modality and IS applied). It
-- does not touch exercises.demo_video_url — that column arrives in the unapplied 0039, and the
-- clinician reference clip stays sourced from catalog.ts so there is only ever one source for it. For
-- the same reason `media` is left at its default '{}'.
--
-- WHERE EACH COLUMN COMES FROM:
--   name            catalog.ts name.ru, verbatim.
--   instructions    catalog.ts cues, verbatim and in file order, joined into one Russian paragraph.
--                   /program/[prescriptionId] renders this. Four exercises have no cues in the catalog
--                   and get null, which that page already has an honest "not stated" state for.
--   description     null everywhere. The catalog has no description field. Its `target` and `measures`
--                   are different things and passing one off as a description would be an invention.
--   target_joints   the segments catalog.ts lists in `sensors`, both sides. The schema has no column
--                   for sensor placement, and these are the sites the exercise is watched on.
--   default_dose    {"reps": prescribedRepsDefault} from exerciseConfigs.ts. The four unscored
--                   exercises have no config and therefore no dose: '{}', not an invented ten.
--   scoring_rubric  mirrors exerciseConfigs.ts for the thirteen scored exercises, '{}' for the four
--                   unscored ones (calf-raise, step-up, walking-gait, standing-hip-abduction). Nothing
--                   at runtime reads more than min_valid_excursion_deg (lib/motion/reps.ts:66), which
--                   can only RAISE the default entry threshold, so the rest is documentation.
--   is_published    true. These are the exercises the library already shows the patient.
--
-- WHAT IS NOT SOURCED, said plainly:
--   * `difficulty` is not null and the enum has no 'unspecified' value, so every row carries the
--     column default 'easy'. That is a placeholder, not a clinical grading of any of them.
--   * `modality` is not null and the enum has no value for ankle or hip work. Knee flexion/extension
--     exercises get 'knee_flexion_extension'; walking gets 'gait_balance'; ankle, squat, step and hip
--     work fall back to the generic 'sit_to_stand_lower_limb' bucket. That is a bucket, not a claim.
--   * the rubric 'metric' names are derived mechanically from exerciseConfigs.ts primarySensorRoles —
--     thigh+shank is a knee angle, shank+foot an ankle excursion, thigh alone a thigh elevation. They
--     are labels for what the config already measures, not new clinical definitions.
--
-- THE DRIFT THIS DOES NOT FIX. There is still nothing that keeps catalog.ts and public.exercises in
-- step: the next exercise added to the catalog will be missing from the database again, exactly as
-- these sixteen were. A check that every EXERCISE_CATALOG slug has a row belongs in CI; it is not in
-- this migration because a migration cannot enforce it.

insert into public.exercise_packs (id, slug, title, modality, description) values
  ('e0000000-0000-0000-0000-0000000000a3', 'knee-rehab', 'Knee rehabilitation',
   'sit_to_stand_lower_limb', 'Post-op / conservative knee ROM and strength progressions, BLE-sensor scored.')
on conflict (id) do nothing;

insert into public.exercises
  (pack_id, slug, name, modality, target_joints, difficulty, description, instructions,
   default_dose, scoring_rubric, is_published)
values
  ('e0000000-0000-0000-0000-0000000000a3',
   'seated-knee-flexion',
   'Сгибание колена сидя',
   'knee_flexion_extension',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[],
   'easy',
   null,
   'Сидя, перед началом держите голень неподвижно 2–3 секунды. Двигайтесь плавно, не слишком быстро. Удерживайте ногу в конечной точке. Возвращайте ногу в исходное положение.',
   '{"reps":10}'::jsonb,
   '{"schema":"exercise_config/catalog_mirror.v1","approval_state":"draft","scoring_slug":"seated_knee_flexion","target":{"type":"AT_LEAST","metric":"knee_flexion_deg","value":90},"min_valid_excursion_deg":22.5,"reps":10,"sensors":["thigh","shank"],"note":"Mirrors services/frontend/src/lib/scoring/exerciseConfigs.ts. Engineering config, not clinically approved."}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'prone-knee-bend',
   'Сгибание колена лёжа на животе',
   'knee_flexion_extension',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[],
   'easy',
   null,
   'Лёжа на животе, перед началом держите прямую ногу неподвижно 2–3 секунды. Двигайтесь плавно. Опускайте ногу медленно, не бросайте её.',
   '{"reps":10}'::jsonb,
   '{"schema":"exercise_config/catalog_mirror.v1","approval_state":"draft","scoring_slug":"prone_knee_bend","target":{"type":"AT_LEAST","metric":"knee_flexion_deg","value":90},"min_valid_excursion_deg":22.5,"reps":10,"sensors":["thigh","shank"],"note":"Mirrors services/frontend/src/lib/scoring/exerciseConfigs.ts. Engineering config, not clinically approved."}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'short-arc-quad',
   'Разгибание колена на валике',
   'knee_flexion_extension',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[],
   'easy',
   null,
   'Положите ногу на валик и перед началом не двигайте её 2–3 секунды. Разогните колено и удерживайте ногу в конце движения. Возвращайте ногу плавно.',
   '{"reps":10}'::jsonb,
   '{"schema":"exercise_config/catalog_mirror.v1","approval_state":"draft","scoring_slug":"short_arc_quad","target":{"type":"AT_MOST_DEFICIT","metric":"knee_flexion_deg","value":5},"min_valid_excursion_deg":10,"reps":10,"sensors":["thigh","shank"],"note":"Mirrors services/frontend/src/lib/scoring/exerciseConfigs.ts. Engineering config, not clinically approved."}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'straight-leg-raise',
   'Подъём прямой ноги',
   'knee_flexion_extension',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[],
   'easy',
   null,
   'Перед началом нога лежит прямо 2–3 секунды. Держите колено прямым во время подъёма. Удерживайте ногу в верхней точке. Опускайте ногу плавно.',
   '{"reps":10}'::jsonb,
   '{"schema":"exercise_config/catalog_mirror.v1","approval_state":"draft","scoring_slug":"straight_leg_raise","target":{"type":"AT_LEAST","metric":"knee_flexion_deg","value":30},"min_valid_excursion_deg":10,"reps":10,"sensors":["thigh","shank"],"note":"Mirrors services/frontend/src/lib/scoring/exerciseConfigs.ts. Engineering config, not clinically approved."}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'ankle-pumps',
   'Сгибание и разгибание стопы',
   'sit_to_stand_lower_limb',
   array['l_shank','r_shank','l_foot','r_foot']::public.body_site[],
   'easy',
   null,
   'Перед началом держите стопу 2 секунды в удобном нейтральном положении. Делайте полный цикл: носок от себя и на себя. Двигайтесь ритмично и плавно.',
   '{"reps":15}'::jsonb,
   '{"schema":"exercise_config/catalog_mirror.v1","approval_state":"draft","scoring_slug":"ankle_pumps","target":{"type":"AT_LEAST","metric":"ankle_excursion_deg","value":20},"min_valid_excursion_deg":8,"reps":15,"sensors":["shank","foot"],"note":"Mirrors services/frontend/src/lib/scoring/exerciseConfigs.ts. Engineering config, not clinically approved."}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'mini-squat',
   'Мини-приседание',
   'sit_to_stand_lower_limb',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[],
   'easy',
   null,
   'Перед началом постойте спокойно 2–3 секунды. Приседайте неглубоко, не глубже заданного диапазона. Двигайтесь плавно вниз и вверх. Возвращайтесь в исходное положение.',
   '{"reps":10}'::jsonb,
   '{"schema":"exercise_config/catalog_mirror.v1","approval_state":"draft","scoring_slug":"mini_squat","target":{"type":"BAND","metric":"knee_flexion_deg","value":30},"min_valid_excursion_deg":10,"reps":10,"sensors":["thigh","shank"],"note":"Mirrors services/frontend/src/lib/scoring/exerciseConfigs.ts. Engineering config, not clinically approved.","target_bands":[{"minDeg":25,"maxDeg":35,"score":100},{"minDeg":20,"maxDeg":24,"score":80},{"minDeg":36,"maxDeg":40,"score":80},{"minDeg":15,"maxDeg":19,"score":60},{"minDeg":41,"maxDeg":45,"score":60},{"minDeg":10,"maxDeg":14,"score":40}]}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'quad-set',
   'Напряжение мышцы бедра',
   'knee_flexion_extension',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[],
   'easy',
   null,
   'Перед началом держите ногу неподвижно 2–3 секунды. Удерживайте положение 5 секунд. Во время удержания не двигайте ногой.',
   '{"reps":10}'::jsonb,
   '{"schema":"exercise_config/catalog_mirror.v1","approval_state":"draft","scoring_slug":"quad_set","target":{"type":"HOLD","metric":"knee_flexion_deg","value":null},"min_valid_excursion_deg":0,"reps":10,"sensors":["thigh","shank"],"note":"Mirrors services/frontend/src/lib/scoring/exerciseConfigs.ts. Engineering config, not clinically approved.","hold_target_seconds":5}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'calf-raise',
   'Подъём на носки',
   'sit_to_stand_lower_limb',
   array['l_shank','r_shank','l_foot','r_foot']::public.body_site[],
   'easy',
   null,
   null,
   '{}'::jsonb,
   '{}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'step-up',
   'Шаг на ступеньку',
   'sit_to_stand_lower_limb',
   array['l_thigh','r_thigh','l_shank','r_shank','l_foot','r_foot']::public.body_site[],
   'easy',
   null,
   null,
   '{}'::jsonb,
   '{}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'walking-gait',
   'Ходьба',
   'gait_balance',
   array['l_thigh','r_thigh','l_shank','r_shank','l_foot','r_foot']::public.body_site[],
   'easy',
   null,
   null,
   '{}'::jsonb,
   '{}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'standing-hip-abduction',
   'Отведение ноги в сторону стоя',
   'sit_to_stand_lower_limb',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[],
   'easy',
   null,
   null,
   '{}'::jsonb,
   '{}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'ball-knee-flexion',
   'Сгибание колена с мячом',
   'knee_flexion_extension',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[],
   'easy',
   null,
   'Сидя, катите мяч стопой к себе, сгибая колено. Двигайтесь медленно. Возвращайте ногу в исходное положение так же плавно.',
   '{"reps":10}'::jsonb,
   '{"schema":"exercise_config/catalog_mirror.v1","approval_state":"draft","scoring_slug":"ball_knee_flexion","target":{"type":"AT_LEAST","metric":"knee_flexion_deg","value":90},"min_valid_excursion_deg":22.5,"reps":10,"sensors":["thigh","shank"],"note":"Mirrors services/frontend/src/lib/scoring/exerciseConfigs.ts. Engineering config, not clinically approved."}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'heel-slide-with-band',
   'Скольжение пятки с лентой',
   'knee_flexion_extension',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[],
   'easy',
   null,
   'Лёжа на спине, подтягивайте пятку к себе, помогая себе лентой. Лента помогает движению, а не тянет ногу за вас. Не форсируйте движение через резкую боль.',
   '{"reps":10}'::jsonb,
   '{"schema":"exercise_config/catalog_mirror.v1","approval_state":"draft","scoring_slug":"heel_slide_with_band","target":{"type":"AT_LEAST","metric":"knee_flexion_deg","value":90},"min_valid_excursion_deg":22.5,"reps":10,"sensors":["thigh","shank"],"note":"Mirrors services/frontend/src/lib/scoring/exerciseConfigs.ts. Engineering config, not clinically approved."}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'supported-knee-raise',
   'Подъём колена с поддержкой',
   'knee_flexion_extension',
   array['l_thigh','r_thigh','l_shank','r_shank','l_foot','r_foot']::public.body_site[],
   'easy',
   null,
   'Лёжа на спине, поднимайте согнутое колено, придерживая ногу. Задержитесь в верхней точке, затем медленно опустите. Не задерживайте дыхание.',
   '{"reps":10}'::jsonb,
   '{"schema":"exercise_config/catalog_mirror.v1","approval_state":"draft","scoring_slug":"supported_knee_raise","target":{"type":"AT_LEAST","metric":"knee_flexion_deg","value":60},"min_valid_excursion_deg":15,"reps":10,"sensors":["thigh","shank","foot"],"note":"Mirrors services/frontend/src/lib/scoring/exerciseConfigs.ts. Engineering config, not clinically approved.","hold_target_seconds":0.5}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'seated-knee-extension',
   'Разгибание колена сидя',
   'knee_flexion_extension',
   array['l_thigh','r_thigh','l_shank','r_shank']::public.body_site[],
   'easy',
   null,
   'Сидя на стуле, выпрямляйте колено до горизонтали. Задержитесь в конце движения, затем медленно опустите. Держите бедро прижатым к сиденью.',
   '{"reps":10}'::jsonb,
   '{"schema":"exercise_config/catalog_mirror.v1","approval_state":"draft","scoring_slug":"seated_knee_extension","target":{"type":"AT_LEAST","metric":"knee_flexion_deg","value":80},"min_valid_excursion_deg":20,"reps":10,"sensors":["thigh","shank"],"note":"Mirrors services/frontend/src/lib/scoring/exerciseConfigs.ts. Engineering config, not clinically approved.","hold_target_seconds":0.8}'::jsonb,
   true),
  ('e0000000-0000-0000-0000-0000000000a3',
   'resisted-ankle-pump',
   'Движения стопой с сопротивлением',
   'sit_to_stand_lower_limb',
   array['l_shank','r_shank','l_foot','r_foot']::public.body_site[],
   'easy',
   null,
   'Тяните носок на себя и от себя, преодолевая сопротивление ленты. Двигайте только стопой, голень остаётся на месте. Проходите полный размах в обе стороны.',
   '{"reps":15}'::jsonb,
   '{"schema":"exercise_config/catalog_mirror.v1","approval_state":"draft","scoring_slug":"resisted_ankle_pump","target":{"type":"AT_LEAST","metric":"ankle_excursion_deg","value":20},"min_valid_excursion_deg":8,"reps":15,"sensors":["shank","foot"],"note":"Mirrors services/frontend/src/lib/scoring/exerciseConfigs.ts. Engineering config, not clinically approved."}'::jsonb,
   true)

on conflict (slug) do nothing;
