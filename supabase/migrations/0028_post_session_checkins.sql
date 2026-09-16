-- 0028_post_session_checkins.sql
-- Post-session check-in (NTZ §14.1, PAT-08): pain before/after, difficulty, how the knee feels, and any
-- new symptoms — under 30 seconds, right after finishing an exercise. A RED-flag symptom (drainage,
-- dizziness, calf pain — lib/scoring/checkinSafety.ts's isRedFlag) must reach the clinician; this table
-- is the real persistence path for that (AC-06), replacing nothing since no check-in existed before.

create table public.post_session_checkins (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.sessions (id) on delete cascade,
  patient_id    uuid not null references public.patients (id) on delete cascade,
  clinic_id     uuid not null references public.clinics (id) on delete cascade,
  pain_before   smallint check (pain_before between 0 and 10),
  pain_after    smallint check (pain_after between 0 and 10),
  difficulty    smallint check (difficulty between 0 and 10),
  knee_feels    text check (knee_feels in ('better', 'same', 'slightly_worse', 'much_worse')),
  new_symptoms  text[] not null default '{}',
  red_flag      boolean not null default false,
  acknowledged_by  uuid references public.clinicians (id) on delete set null,
  acknowledged_at  timestamptz,
  created_at    timestamptz not null default now()
);
comment on table public.post_session_checkins is
  'Patient-reported check-in after finishing a session. red_flag=true must surface to the clinician (AC-06).';
create index post_session_checkins_patient_idx on public.post_session_checkins (patient_id, created_at desc);
create index post_session_checkins_session_idx on public.post_session_checkins (session_id);
create index post_session_checkins_red_flag_idx on public.post_session_checkins (patient_id, red_flag)
  where red_flag and acknowledged_at is null;

alter table public.post_session_checkins enable row level security;

drop policy if exists post_session_checkins_read on public.post_session_checkins;
create policy post_session_checkins_read on public.post_session_checkins
  for select using (app.can_access_patient(patient_id) or app.is_clinic_member(clinic_id));

-- Insert-only via a SECURITY DEFINER RPC (below), never a direct table insert, so patient_id/clinic_id
-- can't be spoofed and red_flag is always server-derived from the symptoms the patient actually picked.

-- Submit the caller's own check-in. Scoped to the caller's own patient_id, like finish_training_session.
-- red_flag is computed server-side (never trust a client-sent boolean for something this safety-critical).
create or replace function public.submit_post_session_checkin(
  p_session      uuid,
  p_pain_before  smallint,
  p_pain_after   smallint,
  p_difficulty   smallint,
  p_knee_feels   text,
  p_new_symptoms text[]
)
returns public.post_session_checkins
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_patient uuid;
  v_clinic  uuid;
  v_red     boolean;
  v_row     public.post_session_checkins;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id, clinic_id into v_patient, v_clinic
  from public.patients where profile_id = v_uid;
  if v_patient is null then
    raise exception 'caller has no patient record' using errcode = '42501';
  end if;

  if not exists (select 1 from public.sessions where id = p_session and patient_id = v_patient) then
    raise exception 'session not found for caller' using errcode = '42501';
  end if;

  v_red := coalesce(p_new_symptoms, '{}') && array['drainage', 'dizziness', 'calf_pain']::text[];

  insert into public.post_session_checkins (
    session_id, patient_id, clinic_id, pain_before, pain_after, difficulty, knee_feels, new_symptoms, red_flag
  ) values (
    p_session, v_patient, v_clinic, p_pain_before, p_pain_after, p_difficulty, p_knee_feels,
    coalesce(p_new_symptoms, '{}'), v_red
  )
  returning * into v_row;

  return v_row;
end;
$$;
comment on function public.submit_post_session_checkin(uuid, smallint, smallint, smallint, text, text[]) is
  'Submit the caller''s own post-session check-in; red_flag is computed server-side. SECURITY DEFINER.';

grant execute on function public.submit_post_session_checkin(uuid, smallint, smallint, smallint, text, text[]) to authenticated;

-- Acknowledge a red-flag check-in (clears it from the clinician's "needs attention" view).
create or replace function public.acknowledge_checkin(p_checkin uuid)
returns public.post_session_checkins
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_clinician uuid;
  v_row       public.post_session_checkins;
begin
  select id into v_clinician from public.clinicians where profile_id = v_uid;
  if v_clinician is null then
    raise exception 'caller is not a clinician' using errcode = '42501';
  end if;

  update public.post_session_checkins
     set acknowledged_by = v_clinician, acknowledged_at = now()
   where id = p_checkin and app.is_clinic_member(clinic_id)
   returning * into v_row;

  if v_row.id is null then
    raise exception 'check-in not found or not in caller''s clinic' using errcode = '42501';
  end if;
  return v_row;
end;
$$;
comment on function public.acknowledge_checkin(uuid) is
  'A clinician acknowledges a check-in (typically a red-flag one). SECURITY DEFINER.';

grant execute on function public.acknowledge_checkin(uuid) to authenticated;

-- Surface the latest check-in (and any unacknowledged red flag) on the clinician portal's per-patient
-- card, alongside sessions/metrics (0022_clinician_portal.sql's app.clinic_patient_json) — additive, no
-- separate alerting/push pipeline in this pass; the clinician sees it on next portal visit (AC-06).
create or replace function app.clinic_patient_json(p_patient uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'patient_id', p.id,
    'profile_id', p.profile_id,
    'name', coalesce(nullif(pr.display_name, ''), nullif(pr.full_name, ''),
                     split_part(pr.email::text, '@', 1), 'Patient'),
    'email', pr.email::text,
    'mrn', p.mrn,
    'date_of_birth', p.date_of_birth,
    'affected_side', p.affected_side,
    'enrollment_status', p.enrollment_status,
    'baseline', p.baseline,
    'condition_slug', c.slug::text,
    'last_session_at', (
      select max(s.started_at) from public.sessions s
      where s.patient_id = p.id and s.status = 'completed'
    ),
    'fog_count', (select count(*) from public.fog_events fe where fe.patient_id = p.id),
    'care_plan', (select to_jsonb(o) from public.care_plan_overrides o where o.patient_id = p.id),
    'latest_checkin', (
      select to_jsonb(k) from public.post_session_checkins k
      where k.patient_id = p.id order by k.created_at desc limit 1
    ),
    'unacknowledged_red_flag_count', (
      select count(*) from public.post_session_checkins k
      where k.patient_id = p.id and k.red_flag and k.acknowledged_at is null
    ),
    'sessions', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'started_at', s.started_at,
          'ended_at', s.ended_at,
          'summary', s.summary,
          'metrics', (select to_jsonb(m) from public.session_metrics m where m.session_id = s.id)
        ) order by s.started_at
      ), '[]'::jsonb)
      from public.sessions s
      where s.patient_id = p.id and s.status = 'completed'
    )
  )
  from public.patients p
  join public.profiles pr on pr.id = p.profile_id
  left join public.conditions c on c.id = p.primary_condition_id
  where p.id = p_patient;
$$;
