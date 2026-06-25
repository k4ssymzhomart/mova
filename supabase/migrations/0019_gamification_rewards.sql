-- 0019_gamification_rewards.sql
-- The XP/streak/badge award loop. When a session is finished, the client calls
-- award_session_rewards(session): the server derives the caller's patient from
-- auth.uid(), computes XP from the persisted session_metrics (so the client can
-- never pick its own delta), advances the daily streak (once per day), and grants
-- any newly-earned badges. SECURITY DEFINER + scoped to the caller, like the 0017
-- self-serve RPCs. Idempotent: base session XP is granted at most once per session.

-- Curate the badge catalog with real, auto-evaluable criteria. Upsert so an already
-- seeded/hosted catalog is corrected in place. Criteria types understood by the RPC:
-- first_session | sessions(count) | streak(days) | quality(min) | reps_total(count) | manual.
insert into public.achievement_defs (code, title, description, criteria, xp_reward) values
  ('first_session', 'First session',   'Completed your first rehab session.',            '{"type":"first_session"}',          50),
  ('sessions_10',   'Ten sessions',     'Completed ten training sessions.',               '{"type":"sessions","count":10}',   100),
  ('sessions_50',   'Half-century',     'Completed fifty training sessions.',             '{"type":"sessions","count":50}',   250),
  ('streak_7',      'Seven-day streak', 'Trained seven days in a row.',                   '{"type":"streak","days":7}',       100),
  ('streak_30',     'Thirty-day streak','Trained thirty days in a row.',                  '{"type":"streak","days":30}',      300),
  ('precision_90',  'Precision',        'Finished a session at 90% movement quality.',    '{"type":"quality","min":0.9}',     120),
  ('reps_500',      'Five hundred reps','Logged five hundred reps across your sessions.', '{"type":"reps_total","count":500}',150),
  ('rom_goal_met',  'Range goal',       'Reached a range-of-motion goal (clinician-set).','{"type":"manual"}',                150)
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
  v_uid          uuid := auth.uid();
  v_patient      uuid;
  v_clinic       uuid;
  v_reps         integer;
  v_quality      numeric;
  v_adherence    numeric;
  v_base         integer := 0;
  v_awarded      integer := 0;
  v_already      integer;
  v_total        integer;
  v_today        date := current_date;
  v_last         date;
  v_cur          integer := 0;
  v_longest      integer := 0;
  v_completed    integer := 0;
  v_best_quality numeric := 0;
  v_reps_total   integer := 0;
  v_new          jsonb := '[]'::jsonb;
  v_def          record;
  v_met          boolean;
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
    select coalesce(max(quality_score), 0), coalesce(sum(reps), 0)
      into v_best_quality, v_reps_total
    from public.session_metrics where patient_id = v_patient;

    for v_def in
      select code, title, criteria, xp_reward
      from public.achievement_defs
      where code not in (select def_code from public.achievements where patient_id = v_patient)
    loop
      v_met := case lower(v_def.criteria->>'type')
        when 'first_session' then v_completed >= 1
        when 'sessions'      then v_completed   >= coalesce((v_def.criteria->>'count')::integer, 2147483647)
        when 'streak'        then v_cur         >= coalesce((v_def.criteria->>'days')::integer, 2147483647)
        when 'quality'       then v_best_quality >= coalesce((v_def.criteria->>'min')::numeric, 2)
        when 'reps_total'    then v_reps_total  >= coalesce((v_def.criteria->>'count')::integer, 2147483647)
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
