# Mova — Product Master Plan (CV + IMU Tele-Rehabilitation)

A phase-by-phase implementation plan for a clinical-grade, evidence-backed, gamified rehabilitation
platform. No code — this is the architecture and sequencing the engineering work follows. Companion
evidence base: [`docs/research_library.md`](research_library.md).

---

## 0. Where we are (project state)

What already exists in the repo and runs today:

- **Data pipeline (done):** canonical IMU schema; adapters for HHAR, Daphnet-FoG, REALDISP; a 50 Hz
  preprocessing pipeline producing **672,221 subject-disjoint windows** (`data/processed/`), train-only
  normalization, and a verified no-leakage split.
- **Model stack (done, training locally):** a LIMU-BERT-style Transformer encoder with placement/dataset
  conditioning; a Lightning module for SSL pretraining + HAR/FoG fine-tuning; clinical metrics
  (sensitivity/specificity/AUROC/macro-F1). The GPU cluster fell through, so training now runs on
  **Apple-Silicon MPS** via `.venv312` + `notebooks/train_local.ipynb`.
- **Backend (done, mock):** FastAPI gateway + TimescaleDB (docker-compose), with a `/api/v1/predict/fog`
  POST + WebSocket served by a deterministic Bachlin-Freeze-Index mock until the trained model is wired in.
- **Frontend (done):** a light, narrative landing page (`services/frontend/src/app`) and a dark clinician
  console at `/dashboard`. The landing now declares product surfaces: **Model · Datasets · Benchmark ·
  Research · Docs**.

This plan extends that foundation into the full product: **after sign-in and a personalized intake, a
patient does camera-guided, gamified rehab exercises; computer vision (a "spider-web" body overlay) plus our
IMU motion model score every movement in real time; clinicians and (mock) medical centers see outcomes.**

---

## 1. Product thesis (why this is cutting-edge *and* proven)

Three pillars, each grounded in the literature (see research library for citations):

1. **Markerless CV pose is clinically usable but imperfect.** Single-camera MediaPipe/BlazePose correlates
   strongly with lab mocap (≈0.91 upper-limb, ≈0.80 lower-limb) and has been used to track post-stroke
   reaching — but it degrades under occlusion and in extreme joint flexion (errors can reach ~17°). *Therefore
   we fuse CV with IMU* rather than trusting either alone.
2. **Gamified / VR rehab works.** RCTs and meta-analyses show VR-supported exercise improves upper-extremity
   motor function and range of motion and, crucially, **adherence and motivation** — the main failure point of
   home rehab. *Therefore the exercise layer is a game, not a checklist.*
3. **The session is a data flywheel.** Every gamified session produces synchronized CV pose + IMU. Per the
   cross-modal literature (IMUTube, Vision2Sensor, COMODO, Wonderwall, Vsens), CV motion can synthesize
   "virtual IMU" and supervise IMU encoders. *Therefore each patient session both delivers therapy and
   improves the Mova model* — a defensible, compounding moat.

**Differentiator vs. incumbents (Sword/Kaia/Hinge):** camera-optional + privacy-first (pose computed
on-device, raw video never leaves the client), IMU-light (1–3 consumer sensors), and a model that generalizes
across patients/devices because it is pretrained self-supervised and continuously fed by the flywheel.

---

## 2. Rehabilitation modalities we support (research-grounded)

| Modality | Primary population | What we measure | CV channel | IMU channel | Evidence (see library) |
|---|---|---|---|---|---|
| **Upper-limb reaching** | stroke | shoulder/elbow ROM, trajectory, smoothness (jerk), symmetry | MediaPipe Pose | wrist + upper-arm | post-stroke reaching via MediaPipe (JNER 2025) |
| **Hand grasp / fine motor** | stroke, post-op hand | finger flexion, grasp aperture, pinch, rep count | MediaPipe Hands | optional ring/glove | synthetic smartwatch IMU from ASL video (Santhalingam 2023) |
| **Head / neck (cervical)** | whiplash, vestibular | cervical ROM, head stability/sway | Face/head pose | head/earbud | (CV validity; IMU head-pose) |
| **Gait & balance / freezing-of-gait** | Parkinson's, fall-risk elderly | cadence, sway, freeze episodes, TUG/BBS proxies | full-body pose | ankle/trunk (our FoG model) | Daphnet-FoG; VR balance RCTs |
| **Sit-to-stand & lower-limb ROM** | ortho (knee/hip) | knee/hip angle, reps, tempo, symmetry | MediaPipe Pose | thigh/shank | knee-angle validation (JMIR) |

Each modality is an **exercise pack**: a set of gamified movements + the kinematic features + the scoring
rubric + clinical references. We ship 2 packs first (upper-limb reaching, gait/balance — they map to our
existing data and the FoG model), then expand.

---

## 3. System architecture (one paragraph per layer)

- **Client (web, later mobile/WebXR):** captures camera frames; runs **on-device pose** (MediaPipe Tasks via
  WASM/WebGPU); renders the **spider-web overlay** and the game; reads optional **IMU over Web Bluetooth**;
  streams only *derived keypoints + metrics* (never raw video) to the backend over WebSocket.
- **Motion-intelligence service:** fuses CV joint-angles + IMU into robust per-frame kinematics; runs the Mova
  IMU model (FoG/HAR/movement-quality); computes session metrics (ROM, reps, smoothness, compensation,
  symmetry, adherence). Replaces the current mock engine.
- **Application backend (FastAPI):** auth, personalization, exercise prescription, session orchestration,
  scoring persistence, clinician + medical-center APIs.
- **Data stores:** Postgres (identity, prescriptions, care plans), **TimescaleDB** (per-frame kinematic
  time-series + session metrics), object store (session artifacts, model checkpoints), Redis (realtime
  pub/sub + queue).
- **Model/MLOps plane:** training (local MPS now, cloud later), checkpoint registry, the flywheel pipeline
  (sessions → virtual-IMU → retrain), evaluation/benchmark harness feeding the public Benchmark page.
- **Credibility surfaces:** the Model / Datasets / Benchmark / Research / Docs pages, each backed by a *real*
  artifact (a model card, the dataset manifests, live benchmark numbers, the cited library, the OpenAPI docs).

---

## 4. The CV "spider-web" pose engine (design)

- **Pose graph:** body (33 landmarks), hands (21/hand), face/head as needed. Edges drawn as a luminous
  **skeleton web**; on top, translucent **segment ribbons** triangulated between adjacent landmarks so the web
  appears to *embrace* each limb and deform per frame — the "spider-web that hugs the body part."
- **Real-time control loop:** every frame → landmarks → joint-angle vectors → exercise target comparison →
  visual feedback (web turns green in-range, amber near-limit, red on compensation) → game state update.
- **Kinematic features:** joint angles (ROM), angular velocity, jerk/smoothness, inter-joint symmetry,
  trunk-compensation flags, rep segmentation + count.
- **Calibration:** A-pose calibration, camera distance/FOV estimate, per-user limb-length normalization;
  per-session lighting/occlusion confidence.
- **Fusion (the key move):** when landmark visibility/confidence drops or the joint enters extreme flexion
  (CV's known failure mode), weight shifts to the IMU estimate (complementary/learned filter). Output is one
  fused kinematic stream the game and the model both consume.
- **Privacy:** pose inference is **on-device**; only keypoints/metrics are transmitted. This is the
  HIPAA/GDPR-friendly, "camera-free-feeling" story and a marketing pillar.

---

## 5. Phase-by-phase plan

Each phase lists **Objective · Research grounding · Workstreams · Deliverables · Definition of Done ·
Dependencies · Risks**. Phases 1–4 are the MVP; 5–9 harden and prove it.

### Phase 1 — Identity & personalized intake (the "onboarding that feels bespoke")
- **Objective:** authenticated users complete a guided, adaptive intake that yields a personalized rehab plan
  and (mock) medical-center linkage.
- **Research grounding:** adherence is the main failure of home rehab; personalization + clinician linkage
  drive engagement (VR-rehab adherence literature).
- **Workstreams:**
  - *Backend:* email/OAuth auth, JWT + refresh, RBAC (patient/clinician/admin), consent capture, audit log.
  - *Frontend:* a multi-step, conversational intake — condition, affected side, goals, pain, schedule, prior
    rehab, equipment (camera only vs camera+IMU); a 60-second **CV-guided baseline ROM assessment** that uses
    the pose engine to seed difficulty.
  - *Integration (mock):* a FHIR-shaped mock service (Patient, Practitioner, CarePlan, Observation, Consent)
    so "medical-center integration" is real plumbing on mock data, swappable to a live EHR later.
  - *Logic:* a rule-based **prescription engine** mapping intake → exercise pack + starting difficulty +
    weekly dose.
- **Deliverables:** auth flows; intake UI; baseline-assessment capture; prescription record; mock-FHIR
  CarePlan; clinician auto-assignment.
- **DoD:** a new patient signs up, completes intake, is linked to a mock clinic + clinician, and lands on a
  personalized "today's session" screen — end to end on mock data, fully working.
- **Dependencies:** Phase 2 baseline assessment reuses the pose engine (build a thin version first).
- **Risks:** intake fatigue → keep it ≤2 min, progressive disclosure, save-and-resume.

### Phase 2 — CV pose engine + spider-web overlay
- **Objective:** a production, on-device pose pipeline with the spider-web overlay and validated joint-angle
  extraction.
- **Research grounding:** markerless validity papers (correlation ≈0.91 upper-limb) *and* their failure modes
  (occlusion, extreme flexion ~17°) — which justify confidence handling + Phase 3 fusion.
- **Workstreams:**
  - *CV:* integrate MediaPipe Tasks (Pose/Hands/Face) via WASM/WebGPU; landmark smoothing; joint-angle math;
    calibration; visibility/occlusion confidence; rep segmentation.
  - *Frontend:* the spider-web renderer (skeleton + segment ribbons), in-range color states, latency budget
    (<50 ms/frame), reduced-motion + accessibility fallbacks.
  - *Validation:* compare extracted angles against a reference (clinician goniometer or a public mocap clip)
    for ≥2 joints; document accuracy + failure modes (this becomes Benchmark/Docs content).
- **Deliverables:** pose engine module; overlay; calibration; a short validity report.
- **DoD:** live camera → stable spider-web → numeric joint angles within a documented error band → rep counts
  on a reference exercise.
- **Dependencies:** none hard; precedes the game.
- **Risks:** browser perf/thermals on low-end devices → WebGPU path + model-size tiers + graceful downgrade.

### Phase 3 — IMU↔CV fusion & the real Mova motion-intelligence service
- **Objective:** replace the mock engine with the trained model and a fused kinematic stream.
- **Research grounding:** complementary sensing (CV strong globally, IMU strong in occlusion/high-rate);
  cross-modal alignment (PRIMUS/COCOA/CroSSL); virtual-IMU from video (IMUTube/Wonderwall/Vsens) for the
  flywheel.
- **Workstreams:**
  - *ML:* finish local FoG/HAR fine-tune; export the encoder + heads (ONNX); a movement-quality head
    (smoothness/compensation) trained on REALDISP ideal-vs-displaced + CV-derived labels.
  - *Service:* a fusion module (learned/complementary filter) producing one kinematic stream; the inference
    service (batch + streaming) returning the standard prediction payload (already the API contract).
  - *Flywheel (design + stub):* session pose+IMU → store paired motion → offline virtual-IMU synthesis →
    periodic retrain; start as an offline batch, automate later.
- **Deliverables:** trained checkpoints + model card; ONNX export; fusion module; streaming inference wired to
  the WebSocket; flywheel data contract.
- **DoD:** a live session yields fused joint angles + model outputs (e.g., FoG risk, movement-quality score),
  persisted and shown — no mock.
- **Dependencies:** Phases 2 (pose) + the local training (in progress).
- **Risks:** sim-to-real gap for virtual-IMU → keep the flywheel *additive* and gated by held-out validation.

### Phase 4 — Gamified rehab engine (the "VR game")
- **Objective:** turn prescribed exercises into engaging, adaptive games driven by the fused motion stream.
- **Research grounding:** VR/serious-game RCTs improving UE function, ROM, and adherence in stroke/Parkinson's.
- **Workstreams:**
  - *Game engine:* a lightweight 3D layer (three.js, WebXR-optional) where pose drives an avatar/cursor;
    exercise primitives — reach-to-target, grasp-and-release, sit-to-stand, balance-hold, head-tracking;
    real-time feedback tied to the spider-web; juice (particles/sound) for motivation.
  - *Adaptivity:* difficulty/dose auto-tunes from performance (ROM achieved, smoothness, success rate); safety
    rails (pain/stop, fatigue detection).
  - *Exercise packs:* author the first two (upper-limb reaching, gait/balance) with clinical scoring rubrics.
- **Deliverables:** game runtime; 2 exercise packs; adaptivity logic; session summary screen.
- **DoD:** a prescribed patient completes a full gamified session; score + metrics persist; difficulty adapts
  next session.
- **Dependencies:** Phases 2–3.
- **Risks:** "game vs therapy" tension → every game maps to a validated clinical movement + metric.

### Phase 5 — Backend, sessions, outcomes & adherence
- **Objective:** robust session lifecycle, time-series outcomes, and adherence analytics.
- **Workstreams:** session orchestration (start/stream/finalize); TimescaleDB hypertables for per-frame
  kinematics + per-session metrics; adherence + progress aggregation; async workers (Redis/queue) for
  post-session processing; object storage for artifacts.
- **Deliverables:** session API; metrics service; adherence/progress endpoints; retention/erasure policy.
- **DoD:** sessions are durable, queryable over time, and drive progress trends + adherence reports.
- **Dependencies:** Phase 3 (metrics), Phase 4 (sessions).
- **Risks:** time-series volume → downsampling + rollups in Timescale.

### Phase 6 — Clinician & medical-center portal (mock EHR/FHIR)
- **Objective:** clinicians review patients, adjust prescriptions, and (mock) medical centers exchange care
  plans/outcomes.
- **Workstreams:** clinician dashboard (roster, session review, ROM/gait/FoG trends, prescription editor);
  mock-FHIR sync (CarePlan/Observation push, Patient/Practitioner link); exportable PDF outcome reports;
  "decision support, not diagnosis" framing throughout.
- **Deliverables:** clinician portal; mock-FHIR integration surface; outcome report generator.
- **DoD:** a clinician reviews a real (mock-data) session, edits a prescription, and exports a report;
  CarePlan/Observation round-trip through the mock FHIR layer.
- **Dependencies:** Phases 1, 5.
- **Risks:** real-EHR variance later → keep the integration behind an adapter interface from day one.

### Phase 7 — Credibility surfaces: Model · Datasets · Benchmark · Research · Docs
- **Objective:** make the landing-page sections real, each backed by a genuine artifact.
- **Workstreams:**
  - *Model:* architecture, training recipe, **model card**, live held-out metrics; lineage to LIMU-BERT/
    UniMTS/RelCon.
  - *Datasets:* the canonical schema + dataset manifests (HHAR/Daphnet/REALDISP, 672k windows) + the roadmap
    set (CAPTURE-24, AMASS); the curation libraries (WHAR/DAGHAR/BenchHAR) explained.
  - *Benchmark:* our generalization protocol (cross-device/position/subject) + baseline comparisons, rendered
    as a live leaderboard from the eval harness.
  - *Research:* the cited library (research_library.md) rendered as a browsable evidence base — **cite + link +
    summarize; store BibTeX/metadata; do NOT host copyrighted PDFs** (link to arXiv/publisher).
  - *Docs:* OpenAPI reference, canonical-schema docs, run/deploy guides, SDK usage.
- **Deliverables:** five content-backed pages + a small content pipeline (MDX or DB-driven).
- **DoD:** each page renders from a real source of truth, not placeholder copy; Benchmark numbers update from
  the eval harness.
- **Dependencies:** Phases 3 (model), 5 (metrics).
- **Risks:** stale content → generate from artifacts, not hand-written numbers.

### Phase 8 — Security, compliance, MLOps & deployment
- **Objective:** make it safe to put real patient data through.
- **Workstreams:** PHI posture (encryption at rest/in transit, tenant isolation, audit, consent, data
  retention/erasure, HIPAA/GDPR review); secrets management + rotation; CI (lint/type/test), container builds,
  IaC, observability (traces/metrics/errors), model/data drift monitoring + retrain triggers.
- **Deliverables:** compliance checklist, CI/CD, monitoring, drift→retrain loop.
- **DoD:** a documented path to handle real PHI; green CI; dashboards live; drift alerts wired.
- **Dependencies:** spans all phases; enforced before any real-patient pilot.
- **Risks:** scope creep → gate by milestone, not perfection.

### Phase 9 — Clinical validation & pilot
- **Objective:** prove the product, not just ship it.
- **Workstreams:** a validity study (our fused kinematics vs. clinician goniometry / mocap on a small cohort);
  an adherence/outcome pilot with one clinic; pre-registered metrics; results feed the Benchmark/Research
  pages and a write-up (thesis + paper).
- **Deliverables:** validity report, pilot results, publishable artifact.
- **DoD:** documented agreement (ICC) for ≥2 joints + an adherence signal vs. baseline.
- **Dependencies:** Phases 2–6 + ethics/IRB approval before any real patient.
- **Risks:** clinical claims → frame as decision-support + agreement, never diagnosis.

---

## 6. Landing section → backing artifact (so nothing is vaporware)

| Page | Source of truth | Built in |
|---|---|---|
| **Model** | model card + live eval metrics + architecture | Phases 3, 7 |
| **Datasets** | `data_manifests/` + canonical schema + 672k-window stats | exists → Phase 7 |
| **Benchmark** | eval harness (cross-device/position/subject) + baselines | Phases 3, 7 |
| **Research** | `docs/research_library.md` (cited, linked, BibTeX) | this doc → Phase 7 |
| **Docs** | OpenAPI + schema + run/deploy guides | exists → Phase 7 |

---

## 7. Sequencing & critical path

```
P1 intake ─┐
P2 pose  ──┼─> P3 fusion+model ──> P4 game ──> P5 sessions ──> P6 clinician/EHR ─┐
           │                                                                     ├─> P9 pilot
P7 credibility surfaces (after P3/P5) ───────────────────────────────────────────┘
P8 security/MLOps runs cross-cutting from P3 onward
```
Build order for a first demo: **P2 (pose) → P1 (intake) → P3 (real model) → P4 (one game) → P7 (Model/Datasets
pages)**. Everything else hardens around that spine.

## 8. Open decisions (need your call before/within each phase)

- Pose backend: MediaPipe Tasks (fast, permissive) vs. a heavier research model (accuracy) — start MediaPipe.
- IMU hardware for the pilot: phone-only vs. add a cheap BLE IMU (ankle for gait, wrist for UE).
- First exercise pack to ship: **upper-limb reaching** (richest CV evidence) or **gait/balance** (matches our
  FoG model). Recommend reaching for the demo, gait for the clinical story.
- Game depth: 2D feedback first vs. straight to WebXR — recommend 2D/3D web first, WebXR as a later pack.
