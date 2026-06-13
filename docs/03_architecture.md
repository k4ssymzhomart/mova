# Mova — System & Training Architecture

Production-oriented design. This doc is the source of truth for repo layout, the data pipeline, the model,
and the full-stack system. No research formatting — this is what we ship.

---

## 1. Repo & data layout

```
mova/
├── data/                     # gitignored; versioned via DVC remote (S3/MinIO)
│   ├── raw/<dataset>/        # immutable original downloads (read-only)
│   ├── interim/              # per-dataset → canonical schema (Parquet)
│   ├── processed/            # windowed, sharded tensors (WebDataset .tar)
│   └── synthetic/            # AMASS → virtual-IMU output
├── data_manifests/           # CHECKED IN (small): schemas, splits, checksums, norm_stats, dataset_cards
├── src/mova/                 # python package (src-layout)
│   ├── data/adapters/        # one adapter per dataset → canonical schema
│   ├── synth/                # AMASS/SMPL → virtual IMU simulator
│   ├── preprocess/           # resample, gravity handling, window, shard
│   ├── models/               # encoder backbone + task heads
│   ├── ssl/                  # masked + contrastive objectives
│   ├── train/                # Lightning modules, loops, callbacks
│   ├── eval/                 # leave-X-out protocols + metrics
│   └── export/               # TorchScript / ONNX / TFLite export
├── configs/                  # Hydra yaml (data/model/ssl/train/eval)
├── services/                 # api (FastAPI) · worker (arq) · frontend (Next.js)
├── infra/                    # docker · k8s · terraform
├── scripts/  notebooks/  tests/  docs/
├── pyproject.toml  dvc.yaml  params.yaml  .gitignore
```

**Decision — do NOT dump datasets in `mova/` root.** Raw data is 100s of GB (CAPTURE-24 alone is huge) and
binary; git chokes on it. We use a strict `raw → interim → processed` lake with **DVC** for versioning so
every experiment pins an exact data hash. Only small text artifacts (schemas, split definitions, checksums,
normalization stats, dataset cards) are committed.

---

## 2. The canonical schema (the single most important decision)

Every dataset is heterogeneous (rate 25–200 Hz, 1–17 sensors, CSV/.mat/.npz/.pkl, different units, different
labels). We map all of them to ONE intermediate representation before any training code sees them.

**Canonical IMU record (per device, per timestamp), stored as partitioned Parquet:**

| field | type | notes |
|------|------|------|
| `t` | float64 | seconds, monotonic per session |
| `acc_{x,y,z}` | float32 | gravity-inclusive, units **g** |
| `gyr_{x,y,z}` | float32 | units **rad/s** |
| `mag_{x,y,z}` | float32? | nullable (most sets lack it) |
| `quat_{w,x,y,z}` | float32? | orientation if provided (DIP/TotalCapture); else null |
| `subject_id`,`session_id`,`device_id` | str | for subject-/device-level splits |
| `placement` | enum | unified body-site ontology (see below) |
| `rate_hz`,`make_model`,`dataset` | meta | provenance |

**Labels (sparse, task-specific sidecar tables):** `activity`, `joint_angles{joint:deg}`, `smpl_pose`,
`fog_flag`, `bbs_score`, `fall_flag`.

**Body-site ontology (enables cross-position generalization):**
`pelvis, lower_back, sternum, head, l/r_upperarm, l/r_wrist, l/r_thigh, l/r_shank, l/r_foot`. Every dataset's
sensor locations map into this enum; unknown → `unspecified`. The model gets a learned placement embedding per
token, so it accepts 1..N sensors and is robust to where the patient sticks the band.

---

## 3. Preprocessing DAG (merging the datasets)

```
raw → [adapter] → canonical Parquet (interim)
                    → [unit harmonize: acc→g, gyr→rad/s, drop/mark mag]
                    → [gravity convention: keep raw frame; store quat if present]
                    → [resample → 50 Hz, polyphase anti-aliased]
                    → [gap handling: interp <100ms, drop longer]
                    → [window: 4 s, 50% overlap → (T=200, C=6) + device/placement mask]
                    → [freeze norm stats on PRETRAIN split only → data_manifests/norm_stats]
                    → [shard: WebDataset .tar, subject-disjoint]  (processed)
                    → [splits: leave-subject / leave-device(HHAR) / leave-position(REALDISP) / leave-dataset]
```

**Canonical rate = 50 Hz** (common denominator across the 6 datasets; standard for IMU SSL). Pose datasets
(TotalCapture/DIP) optionally keep a 60 Hz branch for the joint-angle head.

**Synthetic engine (`src/mova/synth`):** AMASS SMPL pose → place virtual IMUs on mesh vertices at ontology
sites → differentiate orientation/position → gyro + accel → inject realistic degradations (axis bias, gyro
drift, gravity leakage, calibration/orientation jitter, dropout, rate jitter). Output lands in
`data/synthetic/` with **exact** joint-angle GT. This is the only source of dense angle labels at scale.

---

## 4. Model

**Backbone — placement-aware patch Transformer** (`src/mova/models`):
- Input: window `(T=200, C=6)` per device; patchify into patches of 10 samples → tokens.
- Per-token embedding = patch projection + positional (RoPE) + **placement embedding** + **device embedding**.
- Encoder: pre-norm Transformer, ~8 layers, `d_model≈384`, ~10–25M params (fits a single GPU; bf16).
- Accepts variable device sets via attention mask → supports sparse 1–3 IMU inference at deploy.

**SSL objectives (`src/mova/ssl`) — multi-task pretraining:**
1. Masked IMU modeling (mask 60% of patches, reconstruct raw — smooth-L1 in normalized space).
2. Contrastive (NT-Xent over two augmented views: jitter, rotation, time-warp, magnitude-warp, sensor-dropout)
   → drives position/device invariance.
3. Synthetic-only auxiliary: light joint-angle regression on AMASS batches (masked when GT absent).
   `L = λ1·MAE + λ2·InfoNCE + λ3·angle_aux`.

**Downstream heads (`src/mova/models`, fine-tuned):**
- Joint-angle / SMPL-pose regression → metrics MPJAE (deg), MPJPE (mm); + FK position loss + joint-limit &
  velocity-smoothness physics penalties. Train on synthetic AMASS, validate on TotalCapture/DIP-IMU.
- Movement-quality / activity (REALDISP) → CE/focal; cross-position eval.
- Balance & gait: FoG sequence detection (Daphnet) + BBS regression (imu-bbs).
- HHAR = cross-device probe (not a product head; a generalization stress test).

---

## 5. Training loop & orchestration

Stack: PyTorch + Lightning · Hydra configs · DVC data/pipeline versioning · W&B tracking · bf16 mixed
precision · AdamW + cosine LR w/ warmup · grad clip · grad accumulation + activation checkpointing (single-GPU
friendly) · EMA weights · resumable checkpoints · deterministic dataloading w/ logged data hash.

```
# stage 1 — SSL pretrain (CAPTURE-24 + synthetic AMASS + unlabeled portions)
for batch in pretrain_loader:            # webdataset shards, subject-disjoint
    views = augment(batch), augment(batch)
    z = encoder(views, placement_mask)
    loss = λ1*masked_recon + λ2*infonce + λ3*angle_aux(synthetic_mask)
    accumulate→step; ema.update(); periodic leave-X-out linear-probe callback

# stage 2 — fine-tune heads (frozen→unfrozen schedule, low LR on backbone)
for task in [pose, quality, fog, bbs]:
    head = attach(encoder); fit(task_loader); eval(leave_X_out); export→registry
```

**Eval protocol:** leave-person/position/device/dataset-out tables; label-efficiency curves (1/10/100%);
sim-to-real gap (synthetic→real); sensor-count ablation (1/2/3/6). Baselines: from-scratch CNN-LSTM, classic
features+RF, LIMU-BERT, UniMTS re-run on identical splits.

---

## 6. Full-stack system

Two subsystems: an **offline ML pipeline** (produces versioned model artifacts) and an **online serving path**
(turns a patient's IMU session into clinical metrics + live biofeedback).

**Online path:** client (patient app: phone IMU + BLE wearable) → FastAPI gateway (auth JWT/RBAC) →
- *realtime:* WebSocket stream of windows → low-latency inference (on-device ONNX/CoreML for <50 ms form
  feedback; cloud for full pose) → live joint-angle/rep overlay.
- *batch:* session blob → object store → arq/Redis job → inference worker (Triton/ONNX Runtime, GPU) → metrics
  written to Postgres/TimescaleDB → clinician dashboard.

**Stores:** Postgres+TimescaleDB (users, sessions, kinematic metrics over time) · S3/MinIO (raw session blobs,
model artifacts) · Redis (cache, queue, WS pub/sub).

**Model lifecycle:** training → export (TorchScript/ONNX/TFLite/CoreML) → MLflow model registry (versioned) →
deploy to inference service + push edge model to app. Monitoring: data/feature drift, latency, clinician
corrections captured as new labels → retrain trigger (Prefect/Airflow).

**Frontend:** patient app (React Native) — guided exercises, real-time 3D skeleton (three.js from estimated
pose), rep counting, adherence. Clinician dashboard (Next.js + TS) — patient list, session review, ROM trends,
balance/FoG flags, prescription editor, plotly/recharts kinematics.

**Cross-cutting:** Docker (dev compose → k8s prod), Terraform IaC, GitHub Actions CI/CD, OpenTelemetry +
Prometheus/Grafana + Sentry. Health data ⇒ PHI: encryption at rest/in transit, audit logs, tenant isolation,
HIPAA/GDPR posture from day one.

**Tech stack summary**

| Layer | Choice | Why |
|------|--------|-----|
| Data versioning | DVC + S3/MinIO | reproducible data hashes per experiment |
| Training | PyTorch + Lightning + Hydra + W&B | scalable, configurable, tracked |
| Serving | Triton / ONNX Runtime + FastAPI | GPU batch + low-latency, same-lang handoff |
| Async | Redis + arq | decouple ingest from inference, WS pub/sub |
| DB | Postgres + TimescaleDB | relational + time-series in one |
| Blobs | S3 / MinIO | sessions + artifacts |
| Backend | FastAPI (Python) | clean ML↔API boundary |
| Frontend | Next.js (clinician) + React Native (patient) | dashboard + mobile sensor capture |
| Edge | ONNX / CoreML / TFLite | on-device biofeedback, privacy |
| Infra | Docker → k8s, Terraform, GH Actions | portable, reproducible, CI/CD |
| Observability | OTel + Prometheus/Grafana + Sentry | drift, latency, errors |

---

## 7. 48-hour roadmap (build order)

**Day 1 (0–24h) — foundations & the long-pole data licenses**
1. (now) Repo scaffold + `.gitignore` + `git init` ✅; add `pyproject.toml` (ruff, black, mypy, pytest), pre-commit.
2. **Fire off ALL dataset-access requests immediately** (AMASS, DIP-IMU, SMPL, TotalCapture need license
   approval — hours/days). Download the open ones in parallel (CAPTURE-24, REALDISP, Daphnet-FoG, HHAR, imu-bbs).
3. `dvc init`; configure S3/MinIO remote; `dvc add` raw datasets as they land; commit `.dvc` pointers.
4. Freeze the **canonical schema** (`data_manifests/schemas/canonical.json`) + body-site ontology. This unblocks
   everyone.
5. Write **one** end-to-end adapter (HHAR — small, multi-device) raw→canonical Parquet to validate the schema.
6. Stand up `docker-compose` skeleton: Postgres+Timescale, Redis, MinIO, FastAPI "hello", W&B/MLflow.

**Day 2 (24–48h) — pipeline spine & baseline**
7. Adapters for CAPTURE-24, REALDISP, Daphnet-FoG (reuse HHAR patterns).
8. Preprocess pass: resample→50 Hz, windowing, subject-disjoint splits, freeze norm stats → first WebDataset shards.
9. Prototype the **AMASS→virtual-IMU** simulator on a tiny AMASS subset; sanity-check synthesized accel/gyro
   vs a real TotalCapture clip.
10. Reproduce a **LIMU-BERT** masked-pretrain baseline on the HHAR shards (validates training loop + W&B + GPU).
11. Define Hydra config tree (`configs/`) and the leave-X-out eval skeleton (no real numbers yet).
12. Architecture review checkpoint: confirm schema, rate, model size, serving topology before scaling up.

**Definition of done @ 48h:** one dataset flows raw→canonical→windowed→a training step that logs to W&B; AMASS
synth prototype produces plausible signals; all license requests submitted; infra compose boots.
