# Phase 2 — Data Platform & Pipelines

Generalizes the MOVA data platform from 3 IMU datasets to a multi-modal corpus (IMU + pose +
synthetic) feeding the flywheel, wired into a reproducible DVC DAG with frozen splits and a
leakage gate. Source of truth: [`MOVA_MASTER_DOCUMENT.md`](MOVA_MASTER_DOCUMENT.md) Part 7
(Phase 2), Parts 1.4 / 5 / 6; canonical schema [`schemas/canonical.json`](../data_manifests/schemas/canonical.json).

## What's here

| Area | Module | Notes |
|---|---|---|
| IMU adapters (new) | `data/adapters/{capture24,totalcapture,dip_imu,amass}_adapter.py` | canonical-schema, config-driven like the existing 3 |
| Pose adapters (new) | `data/adapters/{kimore,uiprmd}_adapter.py` | long-format canonical pose |
| Virtual IMU | `synth/amass.py`, `synth/rotations.py` | SMPL FK → gyro (exact) + accel + exact joint angles |
| Pose features | `pose/{schema,features,io,pipeline}.py` | joint angles, ROM, smoothness (LDLJ), symmetry |
| LOSO | `preprocess/loso.py` | leave-one-subject-out folds for clinical sets |
| Leakage gate | `data/leakage.py` | subject-disjoint + LOSO + processed checks → report, **exits non-zero on any leak** |
| Flywheel ETL | `flywheel/etl.py` | session pose → virtual IMU → **gated** candidate shards |
| DAG | [`dvc.yaml`](../dvc.yaml) + [`params.yaml`](../params.yaml) | `dvc repro` rebuilds everything |
| Data cards | [`dataset_cards/`](../data_manifests/dataset_cards/) | one per dataset (9) |

The original HHAR / Daphnet / REALDISP adapters and the align → window → split preprocess are
**kept unchanged**; Phase 2 extends around them.

## The DAG (`dvc repro`)

```
raw/* ──adapt (foreach)──▶ interim (canonical Parquet)
raw/amass ──adapt_amass──▶ interim/dataset=amass (virtual IMU)
raw/{kimore,ui_prmd} ──adapt_pose──▶ interim/pose
interim ──preprocess──▶ processed (50 Hz windows + index + norm_stats + subject_splits)
interim(+pose) ──loso──▶ splits/loso
interim/pose ──pose_features──▶ processed/pose
splits + processed ──leakage──▶ leakage_report.json   (gate: 0 leaks)
```

## Verification (fixture-based, no gated data)

The raw datasets are license-gated / multi-GB and not yet downloaded, so the platform is verified
**end-to-end on synthetic fixtures** that match each dataset's real on-disk format
(`tests/fixtures/make_fixtures.py`). This proves pipeline mechanics — schema conformance, 50 Hz
windowing, subject-disjoint splits, LOSO structure, and **zero leakage** — exactly as Phase 1's SQL
was grammar-verified before a live DB run.

`pytest tests/test_data_platform_e2e.py tests/test_data_platform_units.py` (11 tests) exercises every
adapter + preprocess + LOSO + leakage + pose + flywheel. Latest fixture run:

```
canonical interim:  7 IMU datasets, all 25 schema columns, subjects disjoint
windows:            543 (train 225 / val 159 / test 159) across hhar, daphnet_fog,
                    realdisp, capture24, totalcapture, dip_imu, amass
LOSO:               daphnet_fog (4), kimore, ui_prmd folds — each subject tested once
pose features:      6 sessions (ROM, smoothness, symmetry, correct/score labels)
flywheel:           4 sessions → virtual IMU, gate=PENDING (model-in-loop lands in Phase 3)
leakage_report:     leakage_free = true, total_leaks = 0   ✓ DoD
```

Every dataset card carries `format_verified_against_real_data` — `true` for the original three,
`false` for the new six (their real-file layout, encoded in `canonical.json`, is confirmed on the
first `dvc pull`). Gyro derived from orientation (DIP, AMASS) is exact; AMASS accelerometers are
approximate until the licensed SMPL joints are wired in (documented plug-in point).

## Run it

```bash
pip install -e ".[data,dev]"          # polars, pyarrow, scipy, dvc, ...
# fixtures (no downloads):
python tests/fixtures/make_fixtures.py --out /tmp/mova_fixtures
pytest tests/test_data_platform_e2e.py tests/test_data_platform_units.py

# real data:
dvc pull                              # fetch raw/* (after dataset licenses are granted)
dvc repro                             # adapters → windows → splits → LOSO → leakage gate
cat data_manifests/leakage_report.json
```

## DoD status

- [x] canonical schema + original adapters kept; **6 new adapters** added (CAPTURE-24, AMASS,
      KIMORE, UI-PRMD, TotalCapture, DIP-IMU)
- [x] DVC pipeline (`dvc.yaml` + `params.yaml`) — reproducible from one command
- [x] subject-disjoint **+ LOSO** split artifacts frozen as manifests
- [x] pose feature pipeline; flywheel ETL with the validation gate
- [x] per-dataset data cards published
- [x] **leakage = 0** (gate exits non-zero otherwise); window stats reported
- [ ] real-data run (`dvc pull` + `dvc repro`) — pending dataset licenses (AMASS/DIP/CAPTURE-24/etc.)
