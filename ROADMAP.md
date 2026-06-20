# Mova — Product Roadmap

**Vision:** a camera-free motion-intelligence platform that turns 1–3 consumer IMUs into clinical-grade
**activity recognition** and **gait/freezing-of-gait** assessment for home rehabilitation, with a model that
**generalizes across devices and sensor positions**.

**Last updated:** 2026-06-13 · **Owner:** Kassymzhomart Shubay · **Methodology:** Agile (2-week sprints)

---

## How we work

- **Cadence:** 2-week sprints. Each sprint pulls the highest-priority unblocked issues.
- **Board columns:** `Backlog → Ready → In progress → In review → Done`.
- **Estimates (T-shirt → points):** XS=1 · S=2 · M=3 · L=5 · XL=8 · XXL=13.
- **Priority:** `P0` (blocker / critical path) · `P1` (important) · `P2` (nice-to-have).
- **Status legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked.
- **Global Definition of Done:** code merged to `main`; `ruff`+`mypy`+`pytest` green; reproducible (seed + config + data hash logged); documented in the relevant `docs/`; demoable.

---

## Milestones / release plan

| Milestone | Theme | Epics | Exit criteria |
|---|---|---|---|
| **M1 — Model v1** | Pretrained encoder + HAR/FoG results | E1 | SSL beats from-scratch on ≥2 tasks; cross-device/position numbers reported |
| **M2 — Serving** | Model packaged & served | E2 | ONNX parity + MLflow registry + sub-100 ms inference benchmark |
| **M3 — Backend MVP** | API + DB + inference routes | E3 | Upload→inference→metrics persisted; realtime WS demo |
| **M4 — Frontend MVP** | Clinician dashboard + patient capture | E4 | End-to-end session: capture → analyze → review in dashboard |
| **M5 — Integrated pilot** | Hardened, observable, secured | E5, E6 | One clinic pilot on real users; monitoring + auth + PHI posture |

**Critical path:** E1 → E2 → E3 → E4, with E5/E6 running cross-cutting from M2 onward.

---

## ✅ Epic 0 — Foundation (DONE)

*Recap of completed work so the roadmap starts from reality.*

- [x] Repo scaffold, `pyproject.toml` (ruff/black/mypy/pytest), `.gitignore` hardened for secrets
- [x] Canonical IMU schema (`data_manifests/schemas/canonical.json`)
- [x] Dataset adapters: HHAR, Daphnet-FoG, REALDISP → Hive-partitioned canonical Parquet (units → g + rad/s, unified placement ontology)
- [x] DVC tracking of the 3 raw datasets (local cache; S3 remote pending — see E5)
- [x] Preprocessing pipeline: 50 Hz align + windowing + subject-disjoint 80/10/10 splits → **672,221 windows** in `data/processed/` (0 subject leakage), train-only norm stats
- [x] GPU deploy bridge (`scripts/deploy_to_gpu.sh`, SSH key-auth, zero secrets on disk)
- [x] Planning docs (`README.md`, `docs/00–03`)

---

## 🎯 Epic 1 — Model Training & Evaluation

**Goal:** a self-supervised IMU encoder pretrained on the windows, fine-tuned into HAR + clinical-FoG heads,
with a rigorous generalization evaluation (cross-device, cross-position, subject-disjoint).
**Owner:** ML · **Milestone:** M1 · **Depends on:** Epic 0.

- [~] **Issue 1.1 — Stand up the training environment** · `P0` · `M` — _GPU cluster unavailable → pivoted to **local Apple-Silicon MPS** (`.venv312`, torch 2.12 + Lightning 2.6); `fast_dev_run` smoke passes. Cluster steps below kept for when access returns._
  - [ ] Connect Kerio VPN; `ssh-copy-id mova-gpu`; `scripts/deploy_to_gpu.sh --dry-run` then real sync
  - [ ] Create **Python 3.12** venv on `mova-gpu` (3.14 lacks torch wheels); `pip install -e ".[ml]"`
  - [x] _(prep)_ `[ml]` extra pinned for py3.12 (torch/pytorch-lightning/torchmetrics/wandb) + `requirements-gpu.txt` authored
  - [ ] Verify CUDA: `torch.cuda.is_available()`, GPU name, bf16 support; log driver/CUDA versions
  - [ ] Smoke test: load one shard, forward a random tensor through a dummy module on GPU
  - [x] _(prep)_ `scripts/bootstrap_gpu.sh` (venv + install + wandb login + `fast_dev_run` smoke) authored
  - **DoD:** a one-command remote setup script; GPU smoke test passes; environment captured in `docs/`/lockfile.

- [~] **Issue 1.2 — Dataset & DataLoader layer** (`src/mova/train/data.py`) · `P0` · `L` — _drafted; data-layer validated locally, GPU iteration pending_
  - [x] `MovaWindowDataset` over `data/processed/*.npy` + `index.parquet` (memmap, lazy shard load)
  - [x] Apply train-only normalization from `train_stats.json`; expose placement/dataset as conditioning ids
  - [x] Split-aware sampling (train/val/test); task filters (HAR vs FoG; labelled vs unlabelled-for-SSL); `verify_splits` re-check
  - [ ] Augmentations: jitter, scaling, rotation, time-warp, channel/sensor dropout (config-driven) — _transform hook in place; library TBD_
  - [x] Class-imbalance handling for FoG (weighted sampler)
  - **DoD:** deterministic batches; unit tests for shapes/labels/leakage; throughput benchmarked.

- [~] **Issue 1.3 — Encoder backbone** (`src/mova/models/encoder.py`) · `P0` · `L` — _drafted; GPU forward-pass pending_
  - [x] Token embedding (per-timestep 6→hidden) + placement/dataset embeddings + learned positional encoding
  - [x] Transformer encoder (configurable depth/width, ~5–25M params), pre-norm, bf16-friendly + recon/classifier heads
  - [ ] Variable-sensor masking so the model accepts 1..N placements (sparse-sensor inference path) — _single-placement windows for now; multi-sensor fusion deferred_
  - **DoD:** parametrized by Hydra config; param count + FLOPs logged; forward/backward unit-tested.

- [~] **Issue 1.4 — Self-supervised pretraining (LIMU-BERT baseline)** (`src/mova/train/module.py`, `scripts/train.py`) · `P0` · `XL` — _stack drafted; GPU run pending_
  - [x] Masked IMU modeling objective (span mask + BERT 80/10/10; MSE on masked positions)
  - [ ] Contrastive objective (NT-Xent over augmented views) — _deferred to a later iteration_
  - [x] Lightning training loop: AdamW, cosine LR + warmup, grad clip, grad accumulation, bf16 _(EMA TBD)_
  - [x] Hydra config tree (`configs/train.yaml` + `model/` + `trainer/`), W&B logging, resumable checkpoints (`save_last`)
  - [ ] Pretrain on train split (all datasets, labelled + unlabelled windows) — _ready to launch on `mova-gpu`_
  - **DoD:** stable training curve; checkpoint saved; linear-probe on val ≥ random; run reproducible from config.

- [ ] **Issue 1.5 — HAR fine-tuning + evaluation** · `P0` · `L` — _classifier head + acc/macro-F1 metrics wired in `module.py` (`task=har`); training/eval pending GPU_
  - [ ] Classification head on frozen-then-unfrozen encoder; cross-entropy/focal
  - [ ] Train/eval on HHAR + REALDISP labelled windows; metrics: macro-F1, accuracy, confusion matrix
  - [ ] Label-efficiency curves (1% / 10% / 100% labels) — SSL vs from-scratch
  - **DoD:** results table in `docs/`; SSL beats from-scratch at low-label regime; W&B run links.

- [~] **Issue 1.6 — Clinical FoG fine-tuning + evaluation** · `P0` · `L` — _clinical metrics (sensitivity/specificity/AUROC/macro-F1) in `eval/clinical.py`; training locally on MPS via `scripts/fog_local_demo.py` + `notebooks/train_local.ipynb`_
  - [ ] FoG detection head on Daphnet windows (freeze vs no-freeze)
  - [ ] Clinically meaningful metrics: sensitivity, specificity, AUROC, event-level F1 (not just window acc)
  - [ ] Subject-disjoint eval; report per-subject variance; threshold calibration
  - **DoD:** FoG results table; honest reporting of failure subjects; calibration curve.

- [ ] **Issue 1.7 — Generalization protocol (the thesis spine)** · `P0` · `L`
  - [ ] **Cross-device** (HHAR): train on subset of phone/watch models, test on held-out devices
  - [ ] **Cross-position** (REALDISP): train `ideal`, test `self`/`mutual` displacement
  - [ ] **Leave-subject-out** sweeps; aggregate mean ± std
  - **DoD:** generalization tables comparable to the survey's settings; gains attributable to SSL quantified.

- [ ] **Issue 1.8 — Baselines for comparison** · `P1` · `M`
  - [ ] From-scratch CNN-LSTM (supervised); classical features + Random Forest/SVM
  - [ ] Re-run a public SSL baseline (e.g. LIMU-BERT released weights) on identical splits
  - **DoD:** all baselines on the same splits/metrics; one comparison table.

- [ ] **Issue 1.9 — Reproducibility & experiment hygiene** · `P1` · `S`
  - [ ] Seed control, deterministic dataloading, config + data-hash logged per run
  - [ ] DVC pipeline stage(s) for preprocess→pretrain→finetune (`dvc.yaml`)
  - **DoD:** any result re-creatable from a single `dvc repro` + config.

---

## 📦 Epic 2 — ML Model Export & Serving

**Goal:** package the trained model into a versioned, production-served artifact with preprocessing parity
and benchmarked latency. **Owner:** ML/MLOps · **Milestone:** M2 · **Depends on:** E1 (≥ a usable checkpoint).

- [ ] **Issue 2.1 — Experiment tracking + model registry** · `P0` · `M`
  - [ ] Stand up MLflow (server + backend store + artifact store on S3/MinIO)
  - [ ] Register encoder + each head as versioned models; stage tags (`staging`/`production`)
  - **DoD:** every trained model lands in the registry with metrics + lineage.

- [ ] **Issue 2.2 — ONNX export + numerical parity** (`src/mova/export/`) · `P0` · `M`
  - [ ] Export encoder+head to ONNX (opset pinned, dynamic axes for batch/sensor count)
  - [ ] Parity test: torch vs ONNXRuntime outputs within tolerance on a fixed validation batch
  - **DoD:** parity test in CI; exported artifact versioned in registry.

- [ ] **Issue 2.3 — Inference preprocessing parity package** · `P0` · `M`
  - [ ] Reusable transform (50 Hz resample + window + normalize) shared by training and serving
  - [ ] Guarantee train/serve skew = 0 (same code path), unit-tested on a golden sample
  - **DoD:** one import used by both training and the inference service.

- [ ] **Issue 2.4 — Latency/throughput optimization & benchmark** · `P1` · `M`
  - [ ] fp16/int8 quantization options; measure accuracy delta
  - [ ] Benchmark single-window latency (target < 100 ms) and batch throughput, CPU vs GPU
  - **DoD:** benchmark table; chosen config documented.

- [ ] **Issue 2.5 — Model server** · `P0` · `M`
  - [ ] Serve via Triton/ONNXRuntime; define model repository layout + config
  - [ ] Health/readiness endpoints; model-version pinning; warm-up
  - **DoD:** containerized server returns predictions for a posted window.

- [ ] **Issue 2.6 — On-device export (edge biofeedback)** · `P2` · `M`
  - [ ] Export a small model to CoreML/TFLite for low-latency on-phone feedback
  - **DoD:** runs on a mobile target with acceptable latency; documented limits.

- [ ] **Issue 2.7 — Model card & governance** · `P1` · `S`
  - [ ] Model card (intended use, data, metrics, limitations, clinical caveats — NOT a diagnosis)
  - **DoD:** `docs/model_card.md` published with each production model.

---

## 🔧 Epic 3 — Backend Infrastructure

**Goal:** a FastAPI application that ingests IMU sessions, runs batch + real-time inference, and persists
clinical metrics. **Owner:** Backend · **Milestone:** M3 · **Depends on:** E2 (served model).

- [~] **Issue 3.1 — FastAPI gateway scaffold** (`services/api/`) · `P0` · `M` — _app + `/health` (DB ping) + CORS + OpenAPI + Dockerfile done; JWT/RBAC auth pending_
  - [ ] App factory, settings via `pydantic-settings` (env, no secrets in code), OpenAPI docs
  - [ ] Auth: JWT + refresh, RBAC (patient / clinician / admin), password hashing
  - **DoD:** `/healthz`, auth flow, and OpenAPI schema live in docker-compose.

- [~] **Issue 3.2 — Database schema + migrations** · `P0` · `L` — _TimescaleDB extension + `fog_events` hypertable init SQL done; SQLAlchemy models + Alembic pending_
  - [ ] Postgres models: users, patients, clinicians, prescriptions, sessions, devices
  - [ ] **TimescaleDB** hypertable for time-series metrics (ROM, gait params, FoG events, adherence)
  - [ ] Alembic migrations; seed/fixtures for dev
  - **DoD:** migrations run clean; ER diagram in `docs/`; indices on query paths.

- [ ] **Issue 3.3 — Object storage & uploads** · `P0` · `M`
  - [ ] S3/MinIO buckets for raw session blobs + model artifacts
  - [ ] Presigned upload URLs; retention policy; checksum verification
  - **DoD:** client can upload a session blob; server records pointer + metadata.

- [~] **Issue 3.4 — Batch inference route** · `P0` · `L` — _`POST /api/v1/predict/fog` live with deterministic mock engine; queue/worker + persistence pending_
  - [ ] `POST /sessions` → store blob → enqueue (Redis + arq) → worker preprocesses + calls model server
  - [ ] Persist window predictions + aggregated clinical metrics to Timescale
  - [ ] Job status endpoint + idempotency + retries/backoff
  - **DoD:** upload → async processing → metrics queryable; worker pool containerized.

- [~] **Issue 3.5 — Real-time inference route** · `P1` · `L` — _`ws /api/v1/predict/fog/stream` implemented (mock); backpressure/reconnect pending_
  - [ ] WebSocket endpoint: stream 50 Hz windows → low-latency inference → live feedback events
  - [ ] Backpressure, sequence ordering, reconnect handling
  - **DoD:** a streamed session yields live predictions under target latency.

- [ ] **Issue 3.6 — Clinical metrics service** · `P1` · `M`
  - [ ] Derive ROM proxies, gait/cadence stats, FoG episodes, session adherence from model outputs
  - [ ] Trend aggregation endpoints (per patient over time)
  - **DoD:** metrics match a hand-computed reference on a sample session.

- [ ] **Issue 3.7 — API contracts, versioning, rate limiting** · `P1` · `S`
  - [ ] Pydantic request/response schemas; `/v1` namespace; rate limiting; pagination
  - **DoD:** typed contract; contract tests; published OpenAPI.

- [~] **Issue 3.8 — Local dev environment** · `P0` · `M` — _compose `api` + `db` (TimescaleDB) with healthcheck + named volume done; rest pending_
  - [x] `docker-compose`: api + postgres+timescale (healthcheck, `depends_on: service_healthy`, named volume)
  - [ ] add worker, redis, minio, mlflow, model server
  - **DoD:** `docker compose up` boots the whole backend locally.

---

## 💻 Epic 4 — Frontend Application

**Goal:** a clinician dashboard and a patient capture app, integrated with the backend, that close the loop
from sensor capture to clinical review. **Owner:** Frontend · **Milestone:** M4 · **Depends on:** E3 (API).

- [~] **Issue 4.1 — Frontend architecture & scaffolding** (`services/frontend/`) · `P0` · `M` — _Next.js dashboard scaffolded; patient app + shared types pending_
  - [x] Next.js (App Router, TS) clinician dashboard scaffold
  - [x] Design system (dark tokens, bento grid, micro-animations), components (`StreamStatus`/`MetricCard`/`PosePlaceholder`/`TelemetryStrip`)
  - [x] Light narrative landing page (`src/app/page.tsx`, Tailwind, scroll reveals) + `/dashboard` route migration; `next build` clean
  - [ ] React Native patient app; shared types package; env config
  - **DoD:** both apps build and render an authenticated shell.

- [ ] **Issue 4.2 — Auth & onboarding** · `P0` · `M`
  - [ ] Login/refresh, role-based routing, patient invite/enrolment, device pairing
  - **DoD:** clinician and patient can sign in and reach their home screens.

- [ ] **Issue 4.3 — Patient app: capture & feedback** · `P0` · `L`
  - [ ] Phone IMU + BLE wearable capture; buffering; upload + live-stream modes
  - [ ] Guided exercise flow; real-time feedback (rep counting, form cues)
  - [ ] 3D skeleton / motion overlay (three.js) and live kinematic plots
  - **DoD:** a patient can record a guided session and see live feedback.

- [~] **Issue 4.4 — Clinician dashboard** · `P0` · `L` — _bento layout + stream-status + pose/telemetry placeholders done; real data wiring + prescription editor pending_
  - [ ] Patient roster, session list/review, ROM & gait trends, FoG flags, adherence
  - [ ] Prescription editor (assign exercises, thresholds, schedule)
  - **DoD:** clinician reviews a processed session and edits a prescription.

- [ ] **Issue 4.5 — Data visualization components** · `P1` · `M`
  - [ ] Reusable time-series charts, episode timelines, 3D pose viewer, progress sparklines
  - **DoD:** components documented in a storybook-style gallery.

- [ ] **Issue 4.6 — API integration layer** · `P0` · `M`
  - [ ] Typed API client (generated from OpenAPI), WebSocket client, auth interceptors, caching
  - **DoD:** all screens backed by real API calls; error/loading states handled.

- [ ] **Issue 4.7 — Accessibility & i18n** · `P2` · `S`
  - [ ] WCAG basics; localization (Kazakh / Russian / English); responsive layouts
  - **DoD:** a11y lint passes; language switch works.

- [ ] **Issue 4.8 — End-to-end tests** · `P1` · `M`
  - [ ] Playwright flows: enrol → capture → analyze → review
  - **DoD:** E2E suite green in CI.

---

## ♻️ Epic 5 — Integration, MLOps & DevOps (cross-cutting)

**Goal:** make the whole system reproducible, observable, and continuously deployable.
**Owner:** MLOps · **Milestone:** M2→M5 · **Runs alongside E1–E4.**

- [ ] **Issue 5.1 — CI pipeline** (GitHub Actions): ruff + black + mypy + pytest on PRs · `P0` · `M`
- [ ] **Issue 5.2 — Pre-commit hooks** wired (`pre-commit` already a dep) · `P1` · `XS`
- [ ] **Issue 5.3 — DVC remote on S3/MinIO** + `dvc push`; data versioning in CI · `P0` · `S`
- [ ] **Issue 5.4 — Container images** for api/worker/model-server/frontend; registry · `P1` · `M`
- [ ] **Issue 5.5 — IaC (Terraform)** for cloud/cluster resources; k8s manifests · `P2` · `L`
- [ ] **Issue 5.6 — Observability:** OpenTelemetry traces, Prometheus + Grafana, Sentry · `P1` · `M`
- [ ] **Issue 5.7 — Model & data drift monitoring** + retraining trigger (Prefect/Airflow) · `P2` · `L`
- [ ] **Issue 5.8 — Release/versioning** (semver, changelog, environment promotion) · `P2` · `S`

---

## 🔐 Epic 6 — Security, Compliance & Launch

**Goal:** handle PHI responsibly and ship a pilot. **Owner:** All · **Milestone:** M5.

- [ ] **Issue 6.1 — Secrets management:** rotate the exposed VPN/SSH creds; move to a vault / SSH keys only · `P0` · `S`
- [ ] **Issue 6.2 — Encryption** at rest + in transit; tenant isolation; audit logging · `P0` · `M`
- [ ] **Issue 6.3 — PHI / compliance posture:** HIPAA/GDPR review, consent, data-retention & deletion · `P1` · `L`
- [ ] **Issue 6.4 — Threat model + dependency/security scan** (SAST, `pip-audit`) · `P1` · `M`
- [ ] **Issue 6.5 — Clinical caveats & disclaimers:** "decision support, not diagnosis" surfaced in UI · `P0` · `S`
- [ ] **Issue 6.6 — Pilot launch:** one physiotherapy clinic; feedback loop; success metrics · `P1` · `L`
- [ ] **Issue 6.7 — Documentation & onboarding** for clinicians and patients · `P2` · `M`

---

## Dependency graph (high level)

```
E0 (done) ──> E1 ──> E2 ──> E3 ──> E4
                      │       │
                      └──> E5 (CI/MLOps, from M2) ──┐
                                                    └──> E6 (Security/Launch, M5)
```

## Risk register

| Risk | Likelihood | Impact | Mitigation | Linked |
|---|---|---|---|---|
| SSL gives no lift over supervised | Med | High | Strong augmentations; label-efficiency framing; report honestly | 1.4, 1.5 |
| Only 3 datasets → limited diversity | High | Med | Lean on cross-device/position axes; frame scope clearly | 1.7 |
| HHAR acc↔gyro alignment is approximate | High | Low | Documented; ablate acc-only vs fused; revisit adapter if needed | 1.2 |
| GPU access / VPN instability | Med | High | Checkpoint + resume; keep runs short; local fallback | 1.1 |
| Python 3.14 vs 3.12 toolchain split | High | Low | 3.12 env on GPU for `[ml]`; 3.14 local for data | 1.1 |
| PHI handling for a real pilot | Med | High | Defer real patient data until E6 posture is met | E6 |
| Scope creep (full product, solo) | High | High | Strict P0 focus per milestone; defer P2 | all |

---

## Definition of Done (per milestone)

- **M1:** reproducible pretraining + HAR/FoG fine-tune; generalization tables; results written to `docs/`.
- **M2:** model in MLflow registry; ONNX parity in CI; latency benchmark met.
- **M3:** `docker compose up` → upload session → metrics persisted → queryable; realtime WS demo.
- **M4:** end-to-end session visible in clinician dashboard; patient app captures + streams.
- **M5:** auth + encryption + monitoring in place; one clinic pilot running; creds rotated.
