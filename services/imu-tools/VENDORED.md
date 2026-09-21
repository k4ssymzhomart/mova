# What is vendored here, and from where

Everything in this package came from **Phoenix**, branch `feat/llm-feedback-two-tier`,
commit **`1480ab0`**. Most of it is Nurzhan's (@Nurzhan06) work.

## The rule

> Files under `src/mova_imu/analysis/` and `src/mova_imu/gateway/` are **vendored and are not
> edited in mova**. A change belongs upstream in Phoenix and is then re-copied here.

A re-sync is meant to be a straight overwrite. That is why `pyproject.toml` excludes both
directories from ruff: linting them would force edits into files that have to stay a clean copy.

mova-authored code lives in `src/mova_imu/sources/`, `src/mova_imu/exercises/`, the `tools/`
shims and `tests/`. Put new work there.

## Copied verbatim

Only a two-line provenance comment was added to the top of each file.

| Here | Phoenix |
|---|---|
| `src/mova_imu/gateway/*.py` (11 files) | `services/imu-gateway/src/phoenix_imu_gateway/*.py` |
| `src/mova_imu/analysis/{exercise_signals,reps,biomechanics,preprocessing,signal_quality,attempt_assessment,execution_score}.py` | `services/api/app/*.py` |
| `src/mova_imu/analysis/rep_quality.py` | `services/api/app/ml/rep_quality.py` |
| `tests/test_{diagnostics,parser,wt901ble68,replay}.py` | `services/imu-gateway/tests/*.py` (import paths only) |
| `tools/{scan_wt901ble68,inspect_gatt,listen_raw,listen_raw_multi}.py` | `services/imu-gateway/*.py` |

## Changed on the way in

Mechanical only. No logic was altered.

- **Import paths.** `app.X` → `mova_imu.analysis.X`; `app.ml.rep_quality` →
  `mova_imu.analysis.rep_quality`; `phoenix_imu_gateway.X` → `mova_imu.gateway.X`.
- **`sys.path` hacks deleted.** Every ported script began by inserting two or four repo paths.
  The package is installed (`pip install -e services/imu-tools`), so they are gone, along with the
  now-stale `# noqa: E402` suppressions. `tools/_path.py` is the one remaining shim: it puts
  `tools/` on the path so the tools that import each other by bare name work when *imported*, not
  only when run.
- **`analysis/rep_quality.py`'s `REFERENCE_DIR`** — the single edit inside a vendored file.
  `checkpoints/rep_quality` → `reference_sets`, because mova's root `.gitignore` has a bare,
  unanchored `checkpoints/` rule (`.gitignore:38`) that would have silently untracked every
  reference set. The rename is commented in place.
- **`tools/rep_labels.py`'s `DEFAULT_CAPTURE_DIR`** → `services/imu-tools/captures`.

## Deliberately not ported

- **`scripts/replay_capture_to_api.py`.** It is wired to Phoenix's deployment, not its analysis:
  `docker compose -f infra/docker-compose.yml`, `psql` inside the compose `postgres` service,
  `POST /api/v1/gateway/imu-packets`, `ORG_ID = "org-demo"`,
  `PRESCRIPTION_ID = "prescription-heel-slide-demo-v1"` and a hardcoded gateway bearer token. None
  of that exists in mova, which ingests through the Supabase RPC `flush_session_telemetry_batch`.
  **`tools/frames_to_capture.py` replaces it** and runs the direction mova actually needs: a mova
  session out of the database and into a capture file the rest of the tools already understand.
  A capture → mova-DB replay, if ever wanted, is separate work and against a local Supabase only.
- `tune_reps.py`'s `--session` / `--list` modes, which read Phoenix's compose Postgres directly.
  Replaced by `--frames <export.json>`; the Phoenix bodies were deleted rather than stubbed.
- `services/imu-gateway/{Dockerfile,run_dev_replay.py,run_synthetic_replay.py}` — Phoenix
  deployment scaffolding.
- `services/api/migrations/versions/0023_execution_score_exercises.sql` — Phoenix's schema
  (`exercise_definitions`, `exercise_prescriptions`, `organization_id`) has no mova counterpart.
  Its *content* — seven exercises, their positions and required sensors — is reused in mova's
  `services/frontend/src/lib/exercises/catalog.ts` instead.

## Re-syncing from Phoenix

```bash
git -C ../../../Phoenix show <ref>:services/api/app/reps.py > src/mova_imu/analysis/reps.py
# then re-add the two provenance lines, re-apply the REFERENCE_DIR rename if rep_quality moved,
# and run:  py -m unittest discover -s tests
```
