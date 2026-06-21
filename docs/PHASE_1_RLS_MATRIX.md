# Phase 1 — RLS policy matrix

The authoritative access model for MOVA's Supabase backend. Mirrors
[`supabase/migrations/0012_rls_policies.sql`](../supabase/migrations/0012_rls_policies.sql)
(+ storage in `0013`, helpers in `0011`). Keep this table and that migration in sync.

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

## Matrix

Legend: ✅ allowed · ⛔ denied · **own** = own row(s) · **patient** = `can_access_patient()` ·
**clinic** = same `clinic_id` · **R** = read · **W** = write.

| Table | patient | clinician | clinic_admin | admin | anon |
|---|---|---|---|---|---|
| `clinics` | R (own clinic) | R (own clinic) | R + W (own) | R + W | ⛔ |
| `profiles` | R/W own | R clinic | R/W own | R/W all | ⛔ |
| `conditions` | R | R | R | R + W | ⛔ |
| `clinicians` | R clinic | R own/clinic | R/W clinic | R/W all | ⛔ |
| `patients` | R/W own | R/W **patient** | R/W clinic | R/W all | ⛔ |
| `care_team_links` | R own | R own | R/W clinic | R/W all | ⛔ |
| `exercise_packs` | R | R | R | R + W | ⛔ |
| `exercises` | R | R | R | R + W | ⛔ |
| `programs` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `prescriptions` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `goals` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `schedules` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `sessions` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `session_metrics` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `session_frames` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `fog_events` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `rom_measurements` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `achievement_defs` | R | R | R | R + W | ⛔ |
| `achievements` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `xp_ledger` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
| `streaks` | R/W **patient** | R/W **patient** | R/W **patient** | R/W all | ⛔ |
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
- `profiles`: a `BEFORE UPDATE` guard (`app.enforce_profile_guard`) blocks anyone but an admin
  from changing their own `role` or `clinic_id` (privilege-escalation defense).
- `audit_log`: no client write policy exists — only the SECURITY DEFINER `app.audit_row()`
  trigger inserts. Reads are admin / clinic_admin only.
- Reference/catalog writes are admin-only; the backend seeds them via `service_role`.

## Storage buckets (`0013_storage.sql`)

| Bucket | Public | Path convention | Read | Write |
|---|---|---|---|---|
| `avatars` | yes | `<user_id>/…` | anyone | own folder |
| `session-artifacts` | no | `<patient_id>/<session_id>/…` | **patient** | **patient** |
| `reports` | no | `<clinic_id>/…` | clinic member | clinician of clinic |
| `model-cards` | yes | `…` | anyone | admin |
| `dataset-manifests` | yes | `…` | anyone | admin |
