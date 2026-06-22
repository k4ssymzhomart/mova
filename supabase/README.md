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
├── migrations/                  # applied in lexical order, 0001 → 0016
│   ├── 0001_extensions.sql      0002_schemas_and_enums.sql   0003_helpers.sql
│   ├── 0004_identity.sql        0005_programs.sql            0006_sessions.sql
│   ├── 0007_gamification.sql    0008_comms.sql               0009_content.sql
│   ├── 0010_audit.sql           0011_rls_helpers.sql         0012_rls_policies.sql
│   ├── 0013_storage.sql         0014_realtime.sql            0015_auth_hooks.sql
│   └── 0016_inference_contract.sql
├── seed.sql                     # reference catalogs + a demo clinic, clinician, patient
├── tests/rls_isolation_test.sql # pgTAP proof of the DoD (cross-patient + cross-clinic isolation)
└── README.md
```

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
