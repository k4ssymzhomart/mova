-- 0025_gamification_v2.sql
-- Aligns the badge catalog with docs/PHOENIX_8_Exercises_Targets (1).docx §12.2's safe-gamification
-- rules: "Badges: Все упражнения выполнены, Плавное движение, Цель движения достигнута" and, just as
-- important, its explicit ban: "Никаких бонусов за reps сверх назначения, ROM сверх target". The old
-- reps_500 (reward raw rep volume) and precision_90 (reward a raw quality number, with no cap semantics)
-- both reward MORE than prescribed rather than doing the plan well — replaced with completion / technique
-- / target-reached badges that award_session_rewards can evaluate without ever paying out for exceeding
-- a target (the underlying session_metrics.extras fields this reads — smoothness, target score — are
-- themselves already capped at 100 by the scoring engine in lib/scoring/, so there is no exceeding to
-- reward in the first place).
--
-- These new badges won't actually fire until real per-session extras (targetScore, smoothness) start
-- flowing from the rebuilt exercise screen (Track C) — that's expected, not a regression: an
-- unevaluable-yet badge is honest (never earned) where a fabricated one would not be.

delete from public.achievement_defs where code in ('reps_500', 'precision_90');

insert into public.achievement_defs (code, title, description, criteria, xp_reward) values
  ('all_exercises_completed', 'All exercises completed', 'Completed every exercise in a day''s plan.',
   '{"type":"all_exercises_completed"}', 120),
  ('smooth_movement', 'Smooth movement', 'Finished a session with notably smooth technique.',
   '{"type":"smoothness","min":0.8}', 120),
  ('target_reached', 'Target reached', 'Reached the prescribed movement target in a session.',
   '{"type":"target_score","min":100}', 120)
on conflict (code) do update set
  title       = excluded.title,
  description = excluded.description,
  criteria    = excluded.criteria,
  xp_reward   = excluded.xp_reward;

create or replace function public.award_session_rewards(p_session uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid                  uuid := auth.uid();
  v_patient              uuid;
  v_clinic               uuid;
  v_reps                 integer;
  v_quality              numeric;
  v_adherence            numeric;
  v_base                 integer := 0;
  v_awarded              integer := 0;
  v_already              integer;
  v_total                integer;
  v_today                date := current_date;
  v_last                 date;
  v_cur                  integer := 0;
  v_longest              integer := 0;
  v_completed            integer := 0;
  v_best_quality         numeric := 0;
  v_best_smoothness      numeric := 0;
  v_best_target_score    numeric := 0;
  v_active_prescriptions integer := 0;
  v_exercises_done_today integer := 0;
  v_all_exercises_done   boolean := false;
  v_new                  jsonb := '[]'::jsonb;
  v_def                  record;
  v_met                  boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id, clinic_id into v_patient, v_clinic
  from public.patients where profile_id = v_uid;
  if v_patient is null then
    raise exception 'caller has no patient record' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.sessions where id = p_session and patient_id = v_patient
  ) then
    raise exception 'session not found for caller' using errcode = '42501';
  end if;

  -- Idempotency: only grant base session XP + advance the streak the first time.
  select count(*) into v_already
  from public.xp_ledger where session_id = p_session and reason = 'session';

  if v_already = 0 then
    select reps, quality_score, adherence into v_reps, v_quality, v_adherence
    from public.session_metrics where session_id = p_session;

    v_base := 20
      + coalesce(v_reps, 0) * 2
      + round(coalesce(v_quality, 0) * 60)::integer
      + round(coalesce(v_adherence, 0) * 10)::integer;
    v_base := least(greatest(v_base, 10), 400);
    v_awarded := v_base;

    insert into public.xp_ledger (patient_id, clinic_id, session_id, delta, reason)
    values (v_patient, v_clinic, p_session, v_base, 'session');

    -- Daily streak (advance at most once per calendar day).
    select last_active_date, current_streak, longest_streak into v_last, v_cur, v_longest
    from public.streaks where patient_id = v_patient for update;
    if not found then
      insert into public.streaks (patient_id, clinic_id, current_streak, longest_streak, last_active_date)
      values (v_patient, v_clinic, 1, 1, v_today);
      v_cur := 1; v_longest := 1;
    elsif v_last is null or v_last < v_today then
      v_cur := case when v_last = v_today - 1 then v_cur + 1 else 1 end;
      v_longest := greatest(v_longest, v_cur);
      update public.streaks
        set current_streak = v_cur, longest_streak = v_longest, last_active_date = v_today
        where patient_id = v_patient;
    end if;

    -- Aggregate stats for badge evaluation.
    select count(*) into v_completed
    from public.sessions where patient_id = v_patient and status = 'completed';
    select coalesce(max(quality_score), 0),
           coalesce(max(smoothness), 0),
           coalesce(max((extras ->> 'targetScore')::numeric), 0)
      into v_best_quality, v_best_smoothness, v_best_target_score
    from public.session_metrics where patient_id = v_patient;

    select count(*) into v_active_prescriptions
    from public.prescriptions where patient_id = v_patient and status = 'active';
    select count(distinct exercise_id) into v_exercises_done_today
    from public.sessions
    where patient_id = v_patient and status = 'completed'
      and exercise_id is not null and started_at::date = v_today;
    v_all_exercises_done := v_active_prescriptions > 0 and v_exercises_done_today >= v_active_prescriptions;

    for v_def in
      select code, title, criteria, xp_reward
      from public.achievement_defs
      where code not in (select def_code from public.achievements where patient_id = v_patient)
    loop
      v_met := case lower(v_def.criteria->>'type')
        when 'first_session'            then v_completed >= 1
        when 'sessions'                 then v_completed        >= coalesce((v_def.criteria->>'count')::integer, 2147483647)
        when 'streak'                   then v_cur               >= coalesce((v_def.criteria->>'days')::integer, 2147483647)
        when 'quality'                  then v_best_quality      >= coalesce((v_def.criteria->>'min')::numeric, 2)
        when 'smoothness'               then v_best_smoothness   >= coalesce((v_def.criteria->>'min')::numeric, 2)
        when 'target_score'             then v_best_target_score >= coalesce((v_def.criteria->>'min')::numeric, 101)
        when 'all_exercises_completed'  then v_all_exercises_done
        else false
      end;
      if v_met then
        insert into public.achievements (patient_id, clinic_id, def_code)
        values (v_patient, v_clinic, v_def.code)
        on conflict (patient_id, def_code) do nothing;
        if v_def.xp_reward > 0 then
          insert into public.xp_ledger (patient_id, clinic_id, session_id, delta, reason)
          values (v_patient, v_clinic, p_session, v_def.xp_reward, 'badge:' || v_def.code);
          v_awarded := v_awarded + v_def.xp_reward;
        end if;
        v_new := v_new || jsonb_build_object('code', v_def.code::text, 'title', v_def.title, 'xp_reward', v_def.xp_reward);
      end if;
    end loop;
  end if;

  select coalesce(sum(delta), 0) into v_total from public.xp_ledger where patient_id = v_patient;
  select coalesce(current_streak, 0), coalesce(longest_streak, 0) into v_cur, v_longest
  from public.streaks where patient_id = v_patient;

  return jsonb_build_object(
    'xp_awarded', v_awarded,
    'total_xp', v_total,
    'prev_total_xp', v_total - v_awarded,
    'current_streak', coalesce(v_cur, 0),
    'longest_streak', coalesce(v_longest, 0),
    'new_badges', v_new
  );
end;
$$;
comment on function public.award_session_rewards(uuid) is
  'Grant XP (from session_metrics), advance the daily streak, and earn badges for the caller''s finished session.';

grant execute on function public.award_session_rewards(uuid) to authenticated;
