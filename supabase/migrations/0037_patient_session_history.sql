-- 0037_patient_session_history.sql (0024 on feature/exercise-screen-rebuild; renumbered past the applied 0036, not applied)
-- Real patient-facing session history. The /progress screen used to read from an on-device
-- localStorage mirror only (lib/insights/store.ts) — real per-session data (sessions + session_metrics)
-- was already being written by finish_training_session, it just had no patient-scoped read path back
-- out. This RPC is the read side: strictly self-scoped (the caller's own patient_id via profile_id =
-- auth.uid()), mirroring the same jsonb-per-row shape app.clinic_patient_json already uses for the
-- clinician portal (0022_clinician_portal.sql), so the same session_metrics.extras payload reads back
-- identically on both surfaces.

create or replace function public.patient_session_history(p_limit integer default 200)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', hs.id,
      'started_at', hs.started_at,
      'ended_at', hs.ended_at,
      'summary', hs.summary,
      'metrics', (select to_jsonb(m) from public.session_metrics m where m.session_id = hs.id)
    ) order by hs.started_at desc
  ), '[]'::jsonb)
  from (
    select s.id, s.started_at, s.ended_at, s.summary
    from public.sessions s
    where s.status = 'completed'
      and s.patient_id = (select id from public.patients where profile_id = auth.uid())
    order by s.started_at desc
    limit greatest(1, least(1000, coalesce(p_limit, 200)))
  ) hs;
$$;
comment on function public.patient_session_history(integer) is
  'Caller''s own completed sessions + metrics, newest first. Self-scoped via patients.profile_id = auth.uid(). SECURITY DEFINER.';

grant execute on function public.patient_session_history(integer) to authenticated;
