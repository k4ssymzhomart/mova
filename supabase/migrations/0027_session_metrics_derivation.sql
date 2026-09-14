-- 0027_session_metrics_derivation.sql
-- finish_training_session() (0017) wrote client-supplied p_metrics verbatim into
-- session_metrics (reps, rom_max, rom_mean, smoothness, symmetry, quality_score,
-- adherence, fog_risk); award_session_rewards() (0019) then computed XP straight from
-- those values. A client posting {"reps":190,"quality_score":1,"adherence":1} could
-- collect the max XP + badges with zero real training.
--
-- session_frames.joint_angles (written by the client per-frame during the session,
-- BEFORE the client knows the final score, unlike p_metrics which is submitted
-- retroactively at finish time) makes an honest, if coarse, server-side derivation of
-- reps/rom_max/rom_mean possible today. quality_score/adherence/smoothness/symmetry
-- genuinely require the ExerciseConfig + SignalQuality scoring engine (a separate,
-- explicitly out-of-scope piece of work per this project's own scope boundary) and
-- must NOT be replaced with another ad-hoc formula here -- they are simply no longer
-- populated from client input, and stay null until that engine exists.
--
-- Known accepted side effect: the 'precision_90' achievement (criteria type
-- "quality") becomes permanently unreachable for new sessions, since quality_score is
-- now always null. This is intentional -- a real-but-fake-passing quality bar is
-- worse than a temporarily-unreachable one -- and is expected to be revisited once
-- the scoring engine lands.

-- Coarse, non-clinical-grade rep counter: counts local maxima of the knee joint-angle
-- series above a low threshold. Interim measure only -- NOT a validated algorithm.
create or replace function app.derive_session_metrics_from_frames(p_session uuid)
returns table (reps integer, rom_max numeric, rom_mean numeric)
language sql stable security definer set search_path = ''
as $$
  with knee as (
    select recorded_at, (joint_angles ->> 'knee')::numeric as deg
    from public.session_frames
    where session_id = p_session and joint_angles ? 'knee'
  ),
  peaks as (
    select
      deg,
      lag(deg) over (order by recorded_at) as prev_deg,
      lead(deg) over (order by recorded_at) as next_deg
    from knee
  )
  select
    (select count(*)::int from peaks where deg > 20 and deg >= prev_deg and deg >= next_deg),
    (select max(deg) from knee),
    (select avg(deg) from knee);
$$;
comment on function app.derive_session_metrics_from_frames(uuid) is
  'Interim server-side derivation of reps/rom from session_frames.joint_angles. Not clinical-grade; '
  'superseded once the ExerciseConfig/SignalQuality scoring engine lands.';

-- Close the caller's session and derive its aggregate metrics server-side from
-- session_frames -- p_metrics is no longer trusted for reps/rom_max/rom_mean/
-- quality_score/adherence/smoothness/symmetry/fog_risk. The raw client claim is kept
-- under extras.client_reported for future anomaly comparison, never written to the
-- scored columns.
create or replace function public.finish_training_session(
  p_session uuid,
  p_summary jsonb default '{}'::jsonb,
  p_metrics jsonb default '{}'::jsonb
)
returns public.sessions
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_patient uuid;
  v_clinic  uuid;
  v_session public.sessions;
  v_derived record;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id, clinic_id into v_patient, v_clinic
  from public.patients where profile_id = v_uid;
  if v_patient is null then
    raise exception 'caller has no patient record' using errcode = '42501';
  end if;

  update public.sessions
     set status   = 'completed',
         ended_at = now(),
         summary  = coalesce(p_summary, '{}'::jsonb)
   where id = p_session and patient_id = v_patient
   returning * into v_session;

  if v_session.id is null then
    raise exception 'session not found for caller' using errcode = '42501';
  end if;

  select * into v_derived from app.derive_session_metrics_from_frames(p_session);

  insert into public.session_metrics (
    session_id, patient_id, clinic_id, reps, rom_max, rom_mean, extras
  ) values (
    p_session, v_patient, v_clinic,
    coalesce(v_derived.reps, 0), v_derived.rom_max, v_derived.rom_mean,
    jsonb_build_object('client_reported', coalesce(p_metrics, '{}'::jsonb))
  )
  on conflict (session_id) do update set
    reps        = excluded.reps,
    rom_max     = excluded.rom_max,
    rom_mean    = excluded.rom_mean,
    extras      = public.session_metrics.extras || excluded.extras,
    computed_at = now();

  return v_session;
end;
$$;
comment on function public.finish_training_session(uuid, jsonb, jsonb) is
  'Mark the caller''s session completed and derive its aggregate metrics server-side from session_frames.';

-- XP is now driven ONLY by server-derived reps -- quality_score/adherence are no
-- longer client-trusted input and are never read here. Ceiling lowered from 400 to
-- 200 since the +60/+10 quality/adherence bonus terms are gone.
create or replace function public.award_session_rewards(p_session uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid          uuid := auth.uid();
  v_patient      uuid;
  v_clinic       uuid;
  v_reps         integer;
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

  select count(*) into v_already
  from public.xp_ledger where session_id = p_session and reason = 'session';

  if v_already = 0 then
    select reps into v_reps
    from public.session_metrics where session_id = p_session;

    v_base := 20 + coalesce(v_reps, 0) * 2;
    v_base := least(greatest(v_base, 10), 200);
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

    -- Aggregate stats for badge evaluation. v_best_quality stays 0 now that
    -- quality_score is never populated, so criteria type "quality" is unreachable
    -- (see file header) until the scoring engine lands.
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
  'Grant XP (reps-only, server-derived), advance the daily streak, and earn badges for the caller''s finished session.';
