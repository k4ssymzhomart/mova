# Phase 1 — RLS policy matrix

The authoritative access model for MOVA's Supabase backend. Mirrors
[`supabase/migrations/0012_rls_policies.sql`](../supabase/migrations/0012_rls_policies.sql)
(+ storage in `0013`, helpers in `0011`, the clinician portal in `0022`/`0024`, tenancy in `0023`,
the write lockdown in `0025`, column immutability in `0026`, and the schema-port tables in
`0029`–`0031`). Keep this table and those migrations in sync.

## Roles

| Role | Who | How resolved |
|---|---|---|
| **patient** | the patient | `profiles.role = 'patient'`; owns a `patients` row |
| **clinician** | a treating clinician | `profiles.role = 'clinician'`; linked via `care_team_links` |
| **clinic_admin** | clinic administrator | `profiles.role = 'clinic_admin'`; scoped to `profiles.clinic_id` |
| **admin** | platform admin | `profiles.role = 'admin'` |
| **anon** | unauthenticated | published content only |
| **service_role** | backend / inference service | **bypasses RLS** (Supabase privileged role) |

## Central predicate

`app.can_access_patient(patient_id)` (SECURITY DEFINER) is **true** when the caller is: a
platform admin · the patient themselves · a clinician with an active `care_team_links` row to
that patient · or a clinic_admin of the patient's clinic. Most per-patient tables delegate to it.

The clinician-portal RPC family (`clinic_caseload`, `clinic_patient_overview`,
`clinic_save_care_plan`, `0022`/`0024`) uses the narrower `app.is_clinic_authorized_for(patient_id)`
— the same admin / clinic_admin / linked-clinician branches as `can_access_patient()`, minus the
patient's own self-branch (these RPCs are clinician-portal-only). Self-serve sign-ups each get
their own 1-patient personal clinic (`0023`), so `clinic_id` equality alone is no longer a usable
proxy for "same real clinic."

## Matrix

Legend: ✅ allowed · ⛔ denied · **own** = own row(s) · **patient** = `can_access_patient()` ·
**clinic** = same `clinic_id` · **R** = read · **W** = write.

| Table | patient | clinician | clinic_admin | admin | anon |
|---|---|---|---|---|---|
| `clinics` | R (own clinic) | R (own clinic) | R + W (own) | R + W | ⛔ |
| `profiles` | R/W own | R clinic | R/W own | R/W all | ⛔ |
| `conditions` | R | R | R | R + W | ⛔ |
| `clinicians` | R clinic | R own/clinic | R/W clinic | R/W all | ⛔ |
| `patients` | R/W own¹ | R/W **patient**¹ | R/W clinic¹ | R/W all | ⛔ |
| `care_team_links` | R own | R own | R/W clinic | R/W all | ⛔ |
| `exercise_packs` | R | R | R | R + W | ⛔ |
| `exercises` | R | R | R | R + W | ⛔ |
| `exercise_configs` | R | R | R | R + W | ⛔ |
| `programs` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `prescriptions` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `goals` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `schedules` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `sessions` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `episodes_of_care` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `session_metrics` | R **patient**² | R **patient**² | R **patient**² | R/W all | ⛔ |
| `session_frames` | R **patient**² | R **patient**² | R **patient**² | R/W all | ⛔ |
| `fog_events` | R **patient**² | R **patient**² | R **patient**² | R/W all | ⛔ |
| `rom_measurements` | R **patient**² | R **patient**² | R **patient**² | R/W all | ⛔ |
| `calibrations` | R **patient**³ | R **patient**³ | R **patient**³ | R/W all | ⛔ |
| `signal_quality` | R **patient**³ | R **patient**³ | R **patient**³ | R/W all | ⛔ |
| `derived_metrics` | R **patient**³ | R **patient**³ | R **patient**³ | R/W all | ⛔ |
| `exercise_scores` | R **patient**³ | R **patient**³ | R **patient**³ | R/W all | ⛔ |
| `algorithm_versions` | R | R | R | R + W | ⛔ |
| `score_versions` | R | R | R | R + W | ⛔ |
| `prompt_versions` | R | R | R | R + W | ⛔ |
| `achievement_defs` | R | R | R | R + W | ⛔ |
| `achievements` | R **patient**² | R **patient**² | R **patient**² | R/W all | ⛔ |
| `xp_ledger` | R **patient**² | R **patient**² | R **patient**² | R/W all | ⛔ |
| `streaks` | R **patient**² | R **patient**² | R **patient**² | R/W all | ⛔ |
| `care_plan_overrides` | R own⁴ | R **patient**⁴ | R **patient**⁴ | R/W all | ⛔ |
| `messages` | R/W own thread | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `notifications` | R/W own | R/W own | R/W own | R/W all | ⛔ |
| `consents` | R/W own | R **patient** | R **patient** | R/W all | ⛔ |
| `content` | R published | R published | R published | R/W all | R published |
| `citations` | R | R | R | R/W all | R |
| `model_registry` | R | R | R | R/W all | ⛔ |
| `benchmark_runs` | R | R | R | R/W all | R |
| `audit_log` | ⛔ | ⛔ | R clinic | R all | ⛔ |
| `inference_jobs` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |

Notes:
- `profiles`: a `BEFORE UPDATE` guard (`app.enforce_profile_guard`) blocks an authenticated end
  user from changing their own `role` or `clinic_id` (privilege-escalation defense). Trusted
  contexts are exempt — the platform admin, and any session with no end-user JWT
  (`auth.uid()` is null: the `service_role` backend, the superuser, and `seed.sql`).
- ¹ `patients`: `clinic_id` specifically is frozen for non-admin end users (`app.freeze_columns`,
  `0026`) — a patient/clinician/clinic_admin can update other columns on a row they can access,
  but never repoint its tenant key. Only an admin (or a trusted `auth.uid() is null` context) may
  change it.
- ² `session_metrics`, `session_frames`, `fog_events`, `rom_measurements`, `achievements`,
  `xp_ledger`, `streaks`: read-only for `authenticated` since `0025` — the prior `for all` policies
  let a patient write these directly over PostgREST, bypassing the SECURITY DEFINER RPCs
  (`finish_training_session`, `award_session_rewards`, `flush_session_telemetry_batch`) that are
  now the only write path. `session_metrics.reps/rom_max/rom_mean` are themselves derived
  server-side from `session_frames` (`0027`), not trusted from client input.
- ³ `calibrations`, `signal_quality`, `derived_metrics`, `exercise_scores` (`0030`/`0031`):
  read-only for `authenticated` and append-only (`app.prevent_row_change`) — written exclusively
  by a future SECURITY DEFINER RPC once the scoring engine exists.
- ⁴ `care_plan_overrides`: read gate tightened to `can_access_patient(patient_id)` (`0024`) — the
  prior policy also granted read via `is_clinic_member(clinic_id)`, true for any profile sharing
  that clinic_id regardless of role or `care_team_links`. Writes are `clinic_save_care_plan` only.
- `audit_log`: no client write policy exists — only the SECURITY DEFINER `app.audit_row()`
  trigger inserts. Reads are admin / clinic_admin only. Rows older than 365 days are purged by
  `app.purge_audit_log()` (`0028`, scheduled via `pg_cron` where available).
- Reference/catalog writes are admin-only; the backend seeds them via `service_role`.

## Storage buckets (`0013_storage.sql`)

| Bucket | Public | Path convention | Read | Write |
|---|---|---|---|---|
| `avatars` | yes | `<user_id>/…` | anyone | own folder |
| `session-artifacts` | no | `<patient_id>/<session_id>/…` | **patient** | **patient** |
| `reports` | no | `<clinic_id>/…` | clinic member | clinician of clinic |
| `model-cards` | yes | `…` | anyone | admin |
| `dataset-manifests` | yes | `…` | anyone | admin |
