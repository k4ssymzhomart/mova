# MOVA Supabase backend (Phase 1)

The app backend: full Postgres schema, the RLS policy matrix, Auth (email/OAuth/MFA),
Storage buckets, Realtime channels, and the typed contract to the Python inference service.
Source of truth: [`docs/MOVA_MASTER_DOCUMENT.md`](../docs/MOVA_MASTER_DOCUMENT.md) Parts 1.5,
2.B/2.C, 6. Access model: [`docs/PHASE_1_RLS_MATRIX.md`](../docs/PHASE_1_RLS_MATRIX.md). Schema
map: [`docs/PHASE_1_ERD.md`](../docs/PHASE_1_ERD.md).

## Layout

```
supabase/
├── config.toml                  # project config: API, Auth (email/OAuth/MFA), Storage, Realtime, hook
├── migrations/                  # applied in lexical order, 0001 → 0042 (see the table below: not all are applied)
├── seed.sql                     # reference catalogs + a demo clinic, clinician, patient
├── tests/                       # pgTAP proofs (RLS isolation, the heel-slide path)
└── README.md
```

## Applied to the hosted project

The numbers are not contiguous — 0024–0033 were used on a branch that was never merged, and 0037–0040
were renumbered past the applied 0036 without being applied. There is no ledger in the database that
this file can be generated from, so this table is maintained by hand, and each migration also states
its own status in its first line. **Update both when you apply something.**

| Migrations | Applied to hosted? | What they are |
|---|---|---|
| `0001` – `0023` | yes | Phase 1: schema, RLS, auth hooks, self-serve RPCs, telemetry streaming, the clinician portal, BLE devices. |
| `0024` – `0033` | — | Do not exist. The numbers were burned on `feature/exercise-screen-rebuild` before the renumber. |
| `0034_heel_slide_path.sql` | yes | The heel-slide session path, and the `knee_flexion_extension` exercise modality every knee row uses. |
| `0035_signup_role_hotfix.sql` | yes | Signup role assignment. |
| `0036_tenancy_fix.sql` | yes | Per-signup clinic; the PHI fix. Everything after this was renumbered past it. |
| `0037_patient_session_history.sql` | **no** | Patient-facing session history. |
| `0038_knee_rehab_exercises.sql` | **no — do not apply as-is** | Seeds eight knee exercises under `snake_case` slugs. Production already has `heel-slide`; this file inserts `heel_slide`, so applying it creates a second Heel Slide. `0042` supersedes it. |
| `0039_exercise_media.sql` | **no** | Adds `exercises.demo_video_url`. Nothing reads it: the reference clip is sourced from `services/frontend/src/lib/exercises/catalog.ts`, and applying this file must not turn that into two sources of truth. |
| `0040_invitations.sql` | **no** | Clinician invitations. |
| `0041_lying_partial_leg_exercises.sql` | yes (2026-09-21) | The two Phoenix lying partial leg raises, kebab-case. |
| `0042_seed_catalog_exercises.sql` | yes (2026-09-21) | The other sixteen catalog exercises, kebab-case, so the session flow can resolve them. Excludes `heel-slide`, which production already holds. |

Note also that the production `heel-slide` row was **not** written by a migration at all: it came from
`services/frontend/scripts/seed-heel-slide.mjs`, with `is_published` false and an empty `target_joints`.
It is still the only unpublished exercise row, and 0042 deliberately left it alone rather than rewrite a
row real patients are prescribed. Publishing it is a one-line change and its own decision.

After 0041 and 0042, `public.exercises` holds 25 rows: the nineteen the catalog describes, plus the six
Phase-1 camera-era rows (`cross-body-reach`, `heel-toe-walk`, `march-in-place`, `overhead-reach`,
`reach-to-target`, `tandem-stand`) that predate the TKA pivot and are not in `catalog.ts`. Those six have
no scoring config, so the exercise screen runs them unscored — which is the honest state for them, not a
bug. Nothing yet keeps `catalog.ts` and `public.exercises` in step; see 0042's header.

### Applying to the hosted project

Port 5432 is blocked from here, so migrations go over HTTPS through the Management API rather than
`supabase db push` (the same route `docs/heel-slide-path.md` uses). Apply one file at a time, in
order, and update the table above in the same commit.

```bash
export SUPABASE_ACCESS_TOKEN=…   # personal access token; never commit it
sq() {
  jq -Rs '{query:.}' < "$1" | curl -sS -X POST \
    "https://api.supabase.com/v1/projects/sbdtujkpklqyevaoxfph/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @-
  echo
}
sq supabase/migrations/0041_lying_partial_leg_exercises.sql
sq supabase/migrations/0042_seed_catalog_exercises.sql
```

Before applying anything, run the offline syntax gate below — it parses every file against the real
PostgreSQL grammar without a database.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- Docker Desktop running (the CLI runs Postgres + Auth + Storage + Studio locally)

## Run it

```bash
cd /path/to/mova
supabase start                 # boots the local stack (first run pulls images)
supabase db reset              # applies all migrations + seed.sql from scratch
supabase test db               # runs the pgTAP RLS isolation tests
supabase db lint               # static checks on the schema
supabase stop                  # tear down
```

`supabase db reset` is the one command that rebuilds everything reproducibly. Studio is at
http://127.0.0.1:54323; the local mailbox (auth emails) at http://127.0.0.1:54324.

### Secrets / env

OAuth + MFA secrets are read from the environment via `env(...)` in `config.toml` — never
committed. Copy the keys from [`.env.example`](../.env.example) into your shell/`.env` before
`supabase start` if you exercise Google/Apple sign-in. Email sign-in and TOTP MFA work with no
secrets locally.

To enable the custom access-token hook (adds `app_role` + `clinic_id` JWT claims), it is
already declared in `config.toml`; on a hosted project also enable it under
**Authentication → Hooks** pointing at `app.custom_access_token_hook`.

## Demo accounts (from `seed.sql`)

| Email | Role | Password |
|---|---|---|
| `clinician@mova.dev` | clinician | `Mova-Demo-1234` |
| `patient@mova.dev` | patient | `Mova-Demo-1234` |
| `admin@mova.dev` | clinic_admin | `Mova-Demo-1234` |

All three belong to **MOVA Demo Clinic**; the clinician is linked to the patient via
`care_team_links`, and the patient has a program, prescription, completed session, metrics, and
a FoG event — enough to render the patient app and clinician portal.

## Definition of Done — how to verify

1. `supabase db reset` applies cleanly and seeds the demo clinic + accounts.
2. `supabase test db` passes — `rls_isolation_test.sql` asserts (among 13 checks):
   - a patient sees **only their own** sessions/metrics/patient row;
   - a clinician sees **only linked** patients (not unlinked ones in the same clinic);
   - a patient in another clinic sees **none** of the first clinic's data;
   - a patient **cannot** read `audit_log`.
3. Sign in as `patient@mova.dev` and `clinician@mova.dev` (auth works end to end).

## Offline syntax gate (no Docker)

Every migration, the seed, and the tests are validated against the **real PostgreSQL grammar**
(libpg_query via `pglast`) without a database — useful in CI or when Docker is unavailable:

```bash
python -m venv .venv-sqlcheck && .venv-sqlcheck/bin/pip install pglast
.venv-sqlcheck/bin/python scripts/db/validate_sql.py     # -> "N/N artifacts valid (all clean)"
```

This is a *syntactic* gate, not a live apply. A green run guarantees the SQL parses for
Postgres; it does **not** replace `supabase db reset` / `supabase test db`, which exercise
constraints, RLS, and the seed against a running database.

## Inference contract

The Supabase↔Python boundary is defined in [`contracts/inference/`](../contracts/inference/)
and surfaced in the DB as `public.inference_jobs` (`0016_inference_contract.sql`).
