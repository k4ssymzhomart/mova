-- 0012_rls_policies.sql
-- Row-Level Security for every table. Model:
--   patient      -> own rows only
--   clinician    -> patients linked via care_team_links (+ same-clinic reads)
--   clinic_admin -> everything in their clinic
--   admin        -> everything (platform)
--   service_role -> bypasses RLS (used by the backend / inference service)
-- Reference/published rows are world-readable. The human-readable matrix lives in
-- docs/PHASE_1_RLS_MATRIX.md and is kept in sync with this file.

-- Enable RLS everywhere ------------------------------------------------------
alter table public.clinics            enable row level security;
alter table public.profiles           enable row level security;
alter table public.conditions         enable row level security;
alter table public.clinicians         enable row level security;
alter table public.patients           enable row level security;
alter table public.care_team_links    enable row level security;
alter table public.exercise_packs     enable row level security;
alter table public.exercises          enable row level security;
alter table public.programs           enable row level security;
alter table public.prescriptions      enable row level security;
alter table public.goals              enable row level security;
alter table public.schedules          enable row level security;
alter table public.sessions           enable row level security;
alter table public.session_metrics    enable row level security;
alter table public.session_frames     enable row level security;
alter table public.fog_events         enable row level security;
alter table public.rom_measurements   enable row level security;
alter table public.achievement_defs   enable row level security;
alter table public.achievements       enable row level security;
alter table public.xp_ledger          enable row level security;
alter table public.streaks            enable row level security;
alter table public.messages           enable row level security;
alter table public.notifications      enable row level security;
alter table public.consents           enable row level security;
alter table public.content            enable row level security;
alter table public.citations          enable row level security;
alter table public.model_registry     enable row level security;
alter table public.benchmark_runs     enable row level security;
alter table public.audit_log          enable row level security;

-- Profile-change guard (role/clinic immutable except by admin) ----------------
create trigger guard_profile before update on public.profiles
  for each row execute function app.enforce_profile_guard();

-- ============================================================================
-- Identity & tenancy
-- ============================================================================

-- clinics: members read; clinic_admin/admin write.
create policy clinics_select on public.clinics for select to authenticated
  using ((select app.is_admin()) or id = (select app.user_clinic_id()));
create policy clinics_insert on public.clinics for insert to authenticated
  with check ((select app.is_admin()));
create policy clinics_update on public.clinics for update to authenticated
  using ((select app.is_admin()) or ((select app.is_clinic_admin()) and id = (select app.user_clinic_id())))
  with check ((select app.is_admin()) or ((select app.is_clinic_admin()) and id = (select app.user_clinic_id())));
create policy clinics_delete on public.clinics for delete to authenticated
  using ((select app.is_admin()));

-- profiles: self + admin + same-clinic clinicians read; self/admin update.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select app.is_admin())
    or ((select app.is_clinician()) and clinic_id = (select app.user_clinic_id()))
  );
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()) or (select app.is_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select app.is_admin()))
  with check (id = (select auth.uid()) or (select app.is_admin()));
create policy profiles_delete on public.profiles for delete to authenticated
  using ((select app.is_admin()));

-- conditions: reference data — any authenticated reads; admin writes.
create policy conditions_select on public.conditions for select to authenticated
  using (true);
create policy conditions_write on public.conditions for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- clinicians: self + same-clinic members read; clinic_admin/admin write.
create policy clinicians_select on public.clinicians for select to authenticated
  using (
    (select app.is_admin())
    or profile_id = (select auth.uid())
    or (clinic_id = (select app.user_clinic_id()) and (select app.is_clinician()))
  );
create policy clinicians_write on public.clinicians for all to authenticated
  using ((select app.is_admin()) or ((select app.is_clinic_admin()) and clinic_id = (select app.user_clinic_id())))
  with check ((select app.is_admin()) or ((select app.is_clinic_admin()) and clinic_id = (select app.user_clinic_id())));

-- patients: the central gate.
create policy patients_select on public.patients for select to authenticated
  using (app.can_access_patient(id));
create policy patients_insert on public.patients for insert to authenticated
  with check (
    (select app.is_clinic_member(clinic_id))
    or (profile_id = (select auth.uid()) and clinic_id = (select app.user_clinic_id()))
  );
create policy patients_update on public.patients for update to authenticated
  using (app.can_access_patient(id)) with check (app.can_access_patient(id));
create policy patients_delete on public.patients for delete to authenticated
  using ((select app.is_admin()) or ((select app.is_clinic_admin()) and clinic_id = (select app.user_clinic_id())));

-- care_team_links: patient + clinician see their own; clinic_admin/admin manage.
create policy care_team_links_select on public.care_team_links for select to authenticated
  using (
    (select app.is_admin())
    or patient_id = (select app.user_patient_id())
    or clinician_id = (select app.user_clinician_id())
    or ((select app.is_clinic_admin()) and clinic_id = (select app.user_clinic_id()))
  );
create policy care_team_links_write on public.care_team_links for all to authenticated
  using ((select app.is_admin()) or ((select app.is_clinic_admin()) and clinic_id = (select app.user_clinic_id())))
  with check ((select app.is_admin()) or ((select app.is_clinic_admin()) and clinic_id = (select app.user_clinic_id())));

-- ============================================================================
-- Catalog (reference data): read by authenticated, write by admin
-- ============================================================================
create policy exercise_packs_select on public.exercise_packs for select to authenticated using (true);
create policy exercise_packs_write on public.exercise_packs for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy exercises_select on public.exercises for select to authenticated using (true);
create policy exercises_write on public.exercises for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy achievement_defs_select on public.achievement_defs for select to authenticated using (true);
create policy achievement_defs_write on public.achievement_defs for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- ============================================================================
-- Per-patient clinical + gamification rows: gated by can_access_patient()
-- ============================================================================
create policy programs_rw on public.programs for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

create policy prescriptions_rw on public.prescriptions for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

create policy goals_rw on public.goals for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

create policy schedules_rw on public.schedules for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

create policy sessions_rw on public.sessions for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

create policy session_metrics_rw on public.session_metrics for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

create policy session_frames_rw on public.session_frames for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

create policy fog_events_rw on public.fog_events for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

create policy rom_measurements_rw on public.rom_measurements for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

create policy achievements_rw on public.achievements for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

create policy xp_ledger_rw on public.xp_ledger for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

create policy streaks_rw on public.streaks for all to authenticated
  using (app.can_access_patient(patient_id)) with check (app.can_access_patient(patient_id));

-- ============================================================================
-- Communications
-- ============================================================================
-- messages: sender, recipient, the patient, or care-team clinicians.
create policy messages_select on public.messages for select to authenticated
  using (
    sender_id = (select auth.uid())
    or recipient_id = (select auth.uid())
    or app.can_access_patient(patient_id)
  );
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and app.can_access_patient(patient_id));
create policy messages_update on public.messages for update to authenticated
  using (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  with check (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()));
create policy messages_delete on public.messages for delete to authenticated
  using (sender_id = (select auth.uid()) or (select app.is_admin()));

-- notifications: per recipient.
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()) or (select app.is_admin()));
create policy notifications_insert on public.notifications for insert to authenticated
  with check (recipient_id = (select auth.uid()) or (select app.is_admin()));
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()) or (select app.is_admin()))
  with check (recipient_id = (select auth.uid()) or (select app.is_admin()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (recipient_id = (select auth.uid()) or (select app.is_admin()));

-- consents: the subject + their care team.
create policy consents_select on public.consents for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (patient_id is not null and app.can_access_patient(patient_id))
    or (select app.is_admin())
  );
create policy consents_insert on public.consents for insert to authenticated
  with check (profile_id = (select auth.uid()) or (select app.is_admin()));
create policy consents_update on public.consents for update to authenticated
  using (profile_id = (select auth.uid()) or (select app.is_admin()))
  with check (profile_id = (select auth.uid()) or (select app.is_admin()));
create policy consents_delete on public.consents for delete to authenticated
  using ((select app.is_admin()));

-- ============================================================================
-- Content & registry: published rows are world-readable; admin writes
-- ============================================================================
create policy content_select_public on public.content for select to anon, authenticated
  using (status = 'published' or (select app.is_admin()));
create policy content_write on public.content for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy citations_select_public on public.citations for select to anon, authenticated
  using (true);
create policy citations_write on public.citations for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy benchmark_runs_select_public on public.benchmark_runs for select to anon, authenticated
  using (true);
create policy benchmark_runs_write on public.benchmark_runs for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy model_registry_select on public.model_registry for select to authenticated
  using (true);
create policy model_registry_write on public.model_registry for all to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- ============================================================================
-- Audit log: read by admin (all) or clinic_admin (own clinic). No client writes.
-- ============================================================================
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select app.is_admin()) or ((select app.is_clinic_admin()) and clinic_id = (select app.user_clinic_id())));

-- ============================================================================
-- Base grants. RLS (above) constrains rows; these grant table-level access.
-- service_role bypasses RLS entirely (backend + inference service).
-- ============================================================================
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
