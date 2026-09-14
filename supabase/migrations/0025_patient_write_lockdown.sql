-- 0025_patient_write_lockdown.sql
-- 0012_rls_policies.sql gave xp_ledger, achievements, streaks, session_metrics,
-- session_frames, fog_events, and rom_measurements `for all` policies keyed on
-- app.can_access_patient(patient_id) -- true for the patient themself. That let a
-- patient's own browser INSERT/UPDATE/DELETE these tables directly over PostgREST,
-- bypassing the SECURITY DEFINER RPCs (finish_training_session, award_session_rewards,
-- flush_session_telemetry_batch, record_session_frames, record_fog_events) that are
-- supposed to be the only write path -- e.g. forging xp_ledger.delta directly, or
-- deleting/altering session_frames a clinician relies on.
--
-- SECURITY DEFINER functions run as the function owner and bypass RLS/grants
-- entirely, so restricting these tables to SELECT-only for `authenticated` does not
-- affect any legitimate RPC write path.

drop policy if exists xp_ledger_rw        on public.xp_ledger;
drop policy if exists achievements_rw     on public.achievements;
drop policy if exists streaks_rw          on public.streaks;
drop policy if exists session_metrics_rw  on public.session_metrics;
drop policy if exists session_frames_rw   on public.session_frames;
drop policy if exists fog_events_rw       on public.fog_events;
drop policy if exists rom_measurements_rw on public.rom_measurements;

create policy xp_ledger_select        on public.xp_ledger        for select to authenticated using (app.can_access_patient(patient_id));
create policy achievements_select     on public.achievements     for select to authenticated using (app.can_access_patient(patient_id));
create policy streaks_select          on public.streaks          for select to authenticated using (app.can_access_patient(patient_id));
create policy session_metrics_select  on public.session_metrics  for select to authenticated using (app.can_access_patient(patient_id));
create policy session_frames_select   on public.session_frames   for select to authenticated using (app.can_access_patient(patient_id));
create policy fog_events_select       on public.fog_events       for select to authenticated using (app.can_access_patient(patient_id));
create policy rom_measurements_select on public.rom_measurements for select to authenticated using (app.can_access_patient(patient_id));

revoke insert, update, delete on
  public.xp_ledger,
  public.achievements,
  public.streaks,
  public.session_metrics,
  public.session_frames,
  public.fog_events,
  public.rom_measurements
from authenticated;

-- NOTE: public.inference_jobs (0016_inference_contract.sql) has the identical `for
-- all` shape on can_access_patient(patient_id). Not locked down here because it needs
-- confirming first whether the inference-enqueuing Edge Function authenticates as the
-- end user (in which case authenticated still needs INSERT) or as service_role (in
-- which case the same select-only treatment applies) -- tracked as a follow-up.
