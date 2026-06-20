# MOVA — Master Project Document

**Type:** Product Requirements Document + Technical Specification
**Audience:** the founder/orchestrator (product vision) and the engineering/ML execution agent.
**Status:** living document — the single source of truth that survives session resets.

> How to use this document: Part 1 captures the story and the locked decisions. Part 2 specifies the reading
> experience. Part 3 is the 10-phase technical roadmap. Part 4 gives a copy-pasteable execution prompt for
> every phase (start a fresh session, paste the prompt, hand it this document). Part 5 is the operating contract.

---

## Table of contents
1. Project story & current state (mission, history, ML core, progress, locked decisions)
2. The "Paper"/Reading integration (educational content UI)
3. Macro-phases — the master technical roadmap (10 phases)
4. Prompt engineering for execution (one prompt per phase)
5. Strict operating & Git rules

---

# Part 1 — Project Story & Current State

## 1.1 Mission
MOVA turns **one or two low-cost inertial sensors plus an ordinary camera** into **clinical-grade
motion intelligence for rehabilitation** — measuring joint angles, movement quality, balance, and
freezing-of-gait at home, **camera-optional and privacy-first**, with a model that **generalizes across
patients, devices, and sensor placements**. The product wraps this engine in a **gamified rehabilitation
experience** that drives the one thing home rehab fails at: adherence.

The name is the thesis: **mova = movement**.

## 1.2 The problem & the wedge
- Physiotherapy outcomes (range of motion, compensation, balance, gait) are still measured by eye or with
  $50k optical motion-capture confined to labs.
- Wearable IMUs and markerless computer-vision pose can measure these objectively — **but only if the model
  generalizes to real patients**, which is the open research problem (the companion survey *Towards
  Generalizable HAR*, arXiv:2508.12213, is built around exactly this gap).
- Market proof: tele-rehab / digital-MSK is **~$5.4B (2024) → ~$15B (2032)**; Sword Health ($4B) acquired
  Kaia Health for $285M (Jan 2026). Incumbents lean on cameras (privacy, fixed location) or proprietary
  sensor suits. **MOVA's wedge:** camera-optional, consumer-grade sparse sensors, on-device privacy, and a
  body-agnostic model — cheaper, private, deployable anywhere (a strong fit for under-served regions).

## 1.3 The story so far (how we got here)
1. **Direction.** Framed MOVA on the Awesome-IMU-Sensing corpus as a *generalizable motion model for rehab*.
2. **Data pipeline.** Built a canonical IMU schema, dataset adapters (HHAR, Daphnet-FoG, REALDISP), and a
   50 Hz preprocessing pipeline → **672,221 subject-disjoint windows**.
3. **Model stack.** Implemented a LIMU-BERT-style Transformer encoder + a PyTorch-Lightning training module
   (self-supervised pretraining + HAR/FoG fine-tuning) + clinical metrics.
4. **Infra & app.** Dockerized FastAPI + TimescaleDB backend with a `/predict/fog` POST + WebSocket served by
   a deterministic Bachlin Freeze-Index mock; a Next.js clinician console; a light, scroll-narrative landing
   page declaring the product surfaces **Model · Datasets · Benchmark · Research · Docs**.
5. **Local-training pivot.** The university GPU cluster became unavailable, so training moved **on-device to
   Apple-Silicon MPS** (Python 3.12 venv, torch 2.12); the FoG model now trains locally + a Jupyter notebook.
6. **A methodology correction (important).** The first FoG run scored a misleading 98.6% accuracy — caused by
   a random subject split handing us a **freeze-free test subject** (sensitivity/AUROC unmeasurable). Fixed
   with a **freeze-stratified split**; re-training in progress. *The lesson is doctrine for MOVA: in clinical
   ML the evaluation design is where fake results hide — get the split right before trusting any number.*

## 1.4 The Machine Learning core (defined by the ML lead)

MOVA is a **multi-task motion-intelligence engine** fusing two modalities — **inertial (IMU)** and
**markerless vision (pose)** — into one kinematic understanding of the body.

### 1.4.1 Tasks
| Task | Modality | Clinical purpose |
|---|---|---|
| Freezing-of-gait (FoG) detection | IMU (+ pose) | the clinical headline (Parkinson's) |
| Human activity recognition (HAR) | IMU | context + exercise recognition + rep counting |
| Movement-quality / compensation scoring | pose (+ IMU) | "is the exercise done correctly?" |
| Joint-angle / range-of-motion estimation | pose + IMU fusion | objective ROM tracking |
| 3D pose / sparse-IMU pose | pose; IMU (roadmap) | the "spider-web" overlay + kinematics |

### 1.4.2 Metrics & required levels (honest, defensible targets)
**Evaluation doctrine:** always report **subject-disjoint** results; for small clinical sets (Daphnet's 10
subjects) use **Leave-One-Subject-Out cross-validation (LOSO-CV)** and report **mean ± std**, plus the
generalization axes the thesis is about: **cross-subject, cross-device (HHAR), cross-position (REALDISP
ideal→self→mutual)**.

- **FoG (window-level, LOSO-CV):** primary = **AUROC** and **AUPRC** (AUPRC matters under class imbalance);
  secondary = **sensitivity at fixed specificity**, balanced accuracy, geometric-mean(sens, spec),
  event-level F1 (windows → episodes). *Targets:* **AUROC ≥ 0.88**, **sensitivity ≥ 0.85 at specificity
  ≥ 0.85** (deep models in the literature reach this; the classic Bachlin Freeze-Index baseline is ~73% sens /
  82% spec — we must beat it convincingly).
- **HAR (cross-subject):** **macro-F1 ≥ 0.90** in-distribution; the *contribution* is quantifying and shrinking
  the cross-device / cross-position drop with self-supervised pretraining.
- **Movement quality (KIMORE / UI-PRMD):** **Spearman/Pearson correlation ≥ 0.7** with clinician scores;
  compensation-detection F1; **ROM MAE ≤ 5°** vs reference.
- **Joint-angle / sparse-IMU pose (TotalCapture / DIP-IMU / AMASS):** **MPJPE ≤ ~80 mm**, **mean joint-angle
  error ≤ 5–8°**.
- **Markerless CV pose vs mocap:** correlation **r ≥ 0.90** (upper limb); fusion must cut the known
  extreme-flexion/occlusion error (~17°) toward **≤ 8°**.

### 1.4.3 Open-source datasets (exact recommendations)
- **In use (IMU):** HHAR (cross-device), Daphnet-FoG (freezing of gait), REALDISP (cross-position).
- **IMU — add next:** **CAPTURE-24** (151 subjects, ~3,900 h free-living — the SSL pretraining fuel),
  PAMAP2, Opportunity, MHEALTH, MobiAct/SisFall/UMAFall (falls), MM-Fit, WISDM.
- **Pose + mocap (joint angles & "virtual-IMU" synthesis):** **AMASS** (mocap → simulate IMU + exact joint
  angles), **TotalCapture**, **DIP-IMU**, **Human3.6M**, **3DPW**, **MoVi**.
- **Rehabilitation-specific with clinician quality scores (critical for the rehab engine):** **KIMORE**
  (clinical + control subjects, rehab exercises with clinician scores), **UI-PRMD** (physical-rehab
  movements), **IntelliRehabDS**, **REHAB24-6**. These are the supervision for movement-quality scoring.

### 1.4.4 Model architectures (exact recommendations)
- **IMU foundation encoder (have):** LIMU-BERT-style Transformer with placement/dataset conditioning;
  self-supervised pretraining via **masked reconstruction + contrastive (RelCon-style)**; light task heads.
  *Roadmap:* scale toward **UniMTS** (unified motion-time-series pretraining) and patch/SSM backbones
  (PatchTST / Mamba) for longer context.
- **Markerless pose (vision):** **MediaPipe BlazePose (GHUM)** + **Hands** + **FaceMesh** for on-device,
  real-time capture (the runtime); **MoveNet** as a lightweight alternative; **MMPose / ViTPose** for
  offline accuracy; **MotionBERT** to lift 2D→3D and recover mesh for kinematics.
- **Movement-quality assessment:** **spatio-temporal graph networks** on the skeleton (ST-GCN / DG-STGCN) —
  the SOTA family on KIMORE/UI-PRMD — optionally fused with the IMU encoder.
- **IMU↔Vision fusion:** a learned complementary filter or a small **cross-modal Transformer**; plus
  **virtual-IMU synthesis from video** (IMUTube / Wonderwall / Vsens) to feed the data flywheel.
- **Kinematics:** compute 3D joint angles from fused pose; optional biomechanical model (OpenSim-style) later.

### 1.4.5 The data flywheel (the moat)
Every gamified session produces **synchronized pose + IMU**. Cross-modal research (IMUTube, Vision2Sensor,
COMODO, PRIMUS, CroSSL) shows vision motion can **synthesize virtual-IMU and supervise IMU encoders**.
Therefore each session both **treats the patient and improves the model** — a compounding, defensible moat.
The flywheel is *additive and gated by held-out validation* so it never degrades the model.

## 1.5 Architectural decisions locked in
1. **Canonical IMU schema** as the single intermediate representation; every dataset adapter conforms.
2. **50 Hz, 4 s (200-sample) windows**, 6 channels (acc xyz + gyro xyz); placement/dataset as conditioning.
3. **Subject-disjoint evaluation always**; **LOSO-CV** for small clinical sets; freeze-stratified splits.
4. **Self-supervised pretraining first**, then light task heads (label scarcity is the core constraint).
5. **Privacy-first CV:** pose runs **on-device**; only keypoints/metrics leave the client, never raw video.
6. **Fusion over single-modality:** CV is strong globally but fails in occlusion/extreme flexion; IMU
   complements — so we fuse.
7. **Mock-but-real integrations:** medical-center / EHR via a **FHIR-shaped** interface on mock data,
   swappable to live systems.
8. **Backend re-platform to Supabase** for app data/auth/storage/realtime, with a **separate Python ML
   inference microservice** (Supabase cannot run torch). See Phase 1.

---

# Part 2 — The "Paper"/Reading Integration (educational content UI)

## 2.1 Goal
A reading experience where users **read, learn, and absorb rapidly without visual clutter** — the evidence
base (research, model cards, dataset cards, docs, benchmarks) rendered as a calm, authoritative library.

## 2.2 Aesthetic specification — "Vercel-native monochrome"
- **Color:** strict **monochrome black-and-white**. One ink (`#0a0a0a` on `#ffffff`, inverted for dark),
  a single faint hairline (`rgba(0,0,0,0.08)`), and **at most one** restrained accent reserved for links/active
  states. No gradients, no decorative color.
- **Geometry:** **sharp, geometric, minimal rounding** (radii 0–4px max; cards are squared, not pill-shaped).
  1px hairline dividers; no heavy borders, no drop shadows beyond a whisper.
- **Type:** a geometric sans for prose (Geist Sans / Inter) + a mono (Geist Mono) for code, captions,
  metadata, and citation keys. **Tight tracking** on headings; **generous line-height (~1.7)** and a
  **measure of ~68 characters** for body text — optimized for reading speed.
- **Layout:** a single centered column with a sticky **table-of-contents** rail, a thin **reading-progress**
  indicator, generous whitespace, and a quiet right-margin for **footnotes / citations**.
- **Motion:** near-none. Content fades/translates in subtly on scroll; everything else is instant. Respect
  `prefers-reduced-motion`.

## 2.3 Content model (and the legal rule)
- The library covers five surfaces: **Research** (papers), **Model** (model cards), **Datasets** (dataset
  cards), **Benchmark** (live leaderboard), **Docs** (API/schema/guides).
- **Legal rule (non-negotiable):** for external papers we **cite + link + summarize** and store **BibTeX /
  metadata** — we **never host copyrighted PDFs**. Each entry renders title, authors, venue/year, our
  one-line summary, a "why it matters for MOVA" note, and an outbound link to arXiv/DOI. The seed library is
  `docs/research_library.md`.
- First-party content (model cards, dataset cards, docs, benchmark write-ups) is authored as structured
  content with equations (KaTeX) and code blocks (mono, syntax-muted to stay monochrome).

## 2.4 Technical approach
- Content as **MDX / a typed content-collection** (or Supabase-backed for editable content), rendered in the
  Next.js app under a shared `reading` layout that enforces the aesthetic.
- KaTeX for math; a monochrome code theme; auto-generated TOC + anchored headings; citation components that
  read from a `references.bib`. Benchmark numbers render from the **eval harness output**, never hand-typed.

---

# Part 3 — Macro-Phases: the Master Technical Roadmap

Ten overarching phases from zero to product. Each: **background → purpose → technical strategy (with the
reasons for each choice)**. Micro-tasks live inside; this is the altitude for planning and review.

### Phase 1 — Foundational Architecture & Backend Platform (Supabase)
- **Background.** We prototyped on FastAPI + TimescaleDB. To move fast on auth, multi-tenant data, storage,
  and realtime — while staying secure for PHI — we standardize the **application backend on Supabase**.
- **Purpose.** A secure, multi-tenant system of record with first-class auth, row-level security, storage,
  and realtime, plus a clean boundary to the ML services.
- **Technical strategy.**
  - **Supabase Postgres** as the system of record. Schema (public): `profiles`, `clinics`, `clinicians`,
    `patients`, `care_plans`, `prescriptions`, `exercises`, `sessions`, `session_metrics`, `fog_events`,
    `content` (papers/cards), `consents`, `audit_log`. Time-series (`session_frames`, metrics over time) use
    the **TimescaleDB extension** (available on Supabase) or native partitioning + continuous aggregates.
  - **Supabase Auth** (email + OAuth + MFA) with **Row-Level Security**: patients see only their own data;
    clinicians see assigned patients; everything is clinic-scoped. RLS is the PHI isolation boundary.
  - **Supabase Storage** for artifacts (session blobs of keypoints/metrics, model cards, dataset manifests),
    **Supabase Realtime** for live clinician view, **Edge Functions** for light serverless logic.
  - **ML inference stays a separate Python microservice** (FastAPI + ONNX/Triton) — Supabase/Deno can't run
    torch. The existing FastAPI service is repurposed as that inference plane. Clear contract between them.
  - Migrations via the **Supabase CLI**; environments dev/staging/prod; secrets in the platform vault.
- **Why these choices.** Supabase collapses auth + DB + storage + realtime + RLS into one secure platform and
  removes months of plumbing; keeping ML in Python preserves the torch/ONNX ecosystem. RLS gives
  defensible PHI isolation from day one.

### Phase 2 — Data Platform & Pipelines
- **Background.** We have a working IMU canonical pipeline (672k windows). We must generalize it to a durable
  data platform that also ingests **vision/pose** and powers the **flywheel**.
- **Purpose.** Reproducible, versioned, leakage-free data for training and evaluation across both modalities.
- **Technical strategy.** Keep the **canonical schema + adapters**; version raw/interim/processed with **DVC**
  (or lakeFS); add adapters for the new datasets (CAPTURE-24, AMASS, KIMORE/UI-PRMD, TotalCapture/DIP-IMU);
  add a **pose-capture pipeline** (frames → keypoints → kinematic features); freeze **subject-disjoint /
  LOSO** splits as artifacts; build the **flywheel ETL** (session pose+IMU → virtual-IMU synthesis →
  curated training shards, gated by validation). Normalization stats and split manifests are committed
  artifacts; everything reproducible from a single command.
- **Why.** Heterogeneous datasets + clinical evaluation demand one schema, hard splits, and provenance, or
  results aren't trustworthy.

### Phase 3 — The Motion-Intelligence ML Core
- **Background.** The encoder + Lightning training stack exist and run locally on MPS; the FoG model is being
  trained on a corrected split.
- **Purpose.** Production models: a self-supervised IMU foundation encoder, clinical/HAR/quality heads, a
  pose-kinematics path, fusion, a registry, and a benchmark harness that feeds the public Benchmark page.
- **Technical strategy.** **SSL pretrain** (masked + contrastive) on the combined real + (later)
  AMASS-synthetic corpus; fine-tune **FoG / HAR / movement-quality** heads; evaluate with **LOSO-CV +
  cross-device/position** protocols; export to **ONNX**; register checkpoints + **model cards**; implement
  the **fusion module** and the **virtual-IMU** generator. Track experiments (W&B / MLflow). Compute scales
  from local MPS now to cloud GPU when available; the code is already device-agnostic.
- **Why.** Label scarcity + the generalization gap make SSL + fusion the only credible route to clinical-grade
  accuracy from sparse sensors.

### Phase 4 — Real-Time Motion Capture & the "Spider-Web" CV Engine
- **Background.** The differentiating UX is a live body overlay that *embraces* the limb and scores movement
  in real time.
- **Purpose.** An on-device, low-latency pose engine + the spider-web renderer + joint-angle extraction +
  IMU fusion runtime.
- **Technical strategy.** **MediaPipe Tasks** (Pose/Hands/Face) via WASM/WebGPU in the browser; landmark
  smoothing; per-frame joint-angle math; **A-pose calibration** + limb-length normalization;
  visibility/occlusion confidence; the **spider-web** overlay (skeleton edges + translucent segment ribbons
  that deform per frame, color-coded in-range/limit/compensation); fusion that shifts weight to IMU when CV
  confidence drops or joints reach extreme flexion. **Raw video never leaves the device.**
- **Why.** Validated markerless pose + IMU fusion gives clinical-usable kinematics at consumer cost, privately.

### Phase 5 — Rehabilitation & Gamification Engine
- **Background.** Adherence is the failure point of home rehab; gamified/VR rehab has RCT-level evidence for
  motor function, ROM, and motivation.
- **Purpose.** Turn prescribed exercises into adaptive games driven by the fused motion stream.
- **Technical strategy.** A lightweight 3D layer (three.js; WebXR-optional) where pose drives an
  avatar/cursor; **exercise primitives** (reach-to-target, grasp-and-release, sit-to-stand, balance-hold,
  head-tracking); **clinical scoring rubrics** per exercise (ROM, smoothness/jerk, symmetry, compensation,
  rep count); **difficulty/dose adaptivity** from performance; **safety rails** (pain/stop, fatigue). Ship
  **two exercise packs first** — upper-limb reaching (richest CV evidence) and gait/balance (matches our FoG
  model). A rule-based **prescription engine** maps the intake profile → pack + starting difficulty + dose.
- **Why.** Every game maps to a validated clinical movement and metric — therapy first, engagement second.

### Phase 6 — Identity, Personalization & Clinical Onboarding
- **Background.** Bespoke onboarding raises engagement and yields the data to personalize therapy.
- **Purpose.** Authenticated, consented users complete an adaptive intake → a personalized plan + (mock)
  medical-center linkage.
- **Technical strategy.** Supabase Auth + RLS; a **conversational, ≤2-minute intake** (condition, affected
  side, goals, pain, schedule, equipment) with progressive disclosure and save-resume; a **60-second
  CV-guided baseline ROM assessment** seeding difficulty; **consent capture + audit**; a **FHIR-shaped mock**
  (Patient / Practitioner / CarePlan / Observation / Consent) behind an adapter interface so it's real
  plumbing on mock data, swappable to a live EHR.
- **Why.** Personalization + clinician linkage drive adherence; the FHIR adapter avoids a rewrite later.

### Phase 7 — Clinician & Medical-Center Portal
- **Background.** Clinics are the B2B2C buyer; clinicians need review + prescription + outcomes.
- **Purpose.** A portal for roster, session review, trends, prescription editing, and (mock) EHR exchange.
- **Technical strategy.** Clinician dashboard (roster, session replay, ROM/gait/FoG trends, prescription
  editor); **mock-FHIR** CarePlan/Observation round-trip; exportable **PDF outcome reports**; the explicit
  framing **"decision support, not diagnosis"** throughout; all data clinic-scoped via RLS.
- **Why.** Outcomes + adherence data are what payers and clinics buy; the EHR adapter keeps integration cheap.

### Phase 8 — Content & Education Platform (Model · Datasets · Benchmark · Research · Docs)
- **Background.** Credibility is a feature: each landing surface must be backed by a *real* artifact.
- **Purpose.** Render the five surfaces from sources of truth in the monochrome reading experience (Part 2).
- **Technical strategy.** **Model** = model card + live held-out metrics; **Datasets** = canonical schema +
  dataset cards + 672k-window stats; **Benchmark** = a live leaderboard generated by the eval harness;
  **Research** = the cited library (link + summarize + BibTeX, no hosted PDFs); **Docs** = OpenAPI + schema +
  guides. A small content pipeline (MDX or Supabase-backed) feeds a shared reading layout.
- **Why.** Generating content from artifacts (not hand-typed copy) keeps it true and never stale.

### Phase 9 — Design System & Frontend Experience
- **Background.** Multiple surfaces (landing, app, console, reading) must feel like one product.
- **Purpose.** A unified, accessible, high-end design system and the app shell that hosts every feature.
- **Technical strategy.** A token-driven **monochrome design system** (sharp geometry, minimal rounding,
  hairlines, the type system from Part 2) as a component library; the marketing landing, the authenticated
  app shell, the clinician console, and the reading layout all consume it; strict accessibility (WCAG),
  i18n-ready, responsive; **Playwright** end-to-end coverage of the core journeys.
- **Why.** One coherent system is the difference between "demo" and "product"; tokens prevent drift.

### Phase 10 — Security/Compliance, MLOps, Observability & Clinical Validation
- **Background.** Real patient data demands safety; clinical claims demand proof.
- **Purpose.** Make MOVA safe to run on real PHI and **prove** it works.
- **Technical strategy.** PHI posture (encryption at rest/in transit, RLS tenant isolation, audit, consent,
  retention/erasure, **HIPAA/GDPR** review); secrets management + rotation; **CI** (lint/type/test),
  container builds, IaC, **observability** (traces/metrics/errors), **data/model drift monitoring → retrain
  triggers**; and a **clinical validation study** (fused kinematics vs. clinician goniometry/mocap on a small
  cohort, **LOSO-CV** for FoG) plus an **adherence pilot** with one clinic — results feed Benchmark/Research
  and a publishable write-up.
- **Why.** Validation is what separates a defensible medical product (and thesis) from a tech demo.

**Critical path:** Phase 1 → 2 → 3 → 4 → 5 → 6 → 7, with Phases 8–9 (content + design system) running
alongside from Phase 3, and Phase 10 cross-cutting from Phase 3 onward. First demo spine: **Phase 4 (pose) →
Phase 6 (intake) → Phase 3 (real model) → Phase 5 (one game) → Phase 8 (Model/Datasets pages)**.

---

# Part 4 — Prompt Engineering for Execution

Paste the matching prompt into a fresh session and attach this document. Every prompt assumes the operating
rules in Part 5 (no AI signatures; commit as `k4ssymzhomart`).

### Prompt — Phase 1 (Backend Platform / Supabase)
```
You are a Principal Backend Architect specializing in Supabase and multi-tenant healthcare systems.
Context: MOVA is a CV+IMU tele-rehabilitation platform (see MOVA_MASTER_DOCUMENT.md). We are standardizing
the application backend on Supabase, with a separate Python ML inference microservice.
Task: Design and implement the Supabase foundation: the full Postgres schema (profiles, clinics, clinicians,
patients, care_plans, prescriptions, exercises, sessions, session_metrics/frames as time-series, fog_events,
content, consents, audit_log); Row-Level Security policies for patient/clinician/clinic isolation; Auth
(email + OAuth + MFA); Storage buckets; and the contract between Supabase and the Python inference service.
Provide migrations via the Supabase CLI and seed data.
Output: SQL migrations, an RLS policy matrix (role × table × operation), an entity-relationship description,
the storage-bucket layout, and a short README on running it locally. Verify migrations apply cleanly.
Rules: no AI-signature comments anywhere; commit as k4ssymzhomart.
```

### Prompt — Phase 2 (Data Platform & Pipelines)
```
You are a Senior Data Engineer for ML. Context: MOVA has a canonical 50 Hz IMU pipeline (672k windows) and
must add vision/pose and the data flywheel (see the master document).
Task: Generalize the data platform: keep the canonical schema + adapters; add DVC versioning; write adapters
for CAPTURE-24, AMASS, KIMORE/UI-PRMD, TotalCapture/DIP-IMU; build the pose-capture feature pipeline; freeze
subject-disjoint and LOSO split artifacts; implement the flywheel ETL (session pose+IMU -> virtual-IMU ->
gated training shards).
Output: adapter modules, a DVC pipeline definition, split + normalization manifests, and a data-card per
dataset. Re-run end to end and report window/leakage statistics.
Rules: no AI signatures; commit as k4ssymzhomart.
```

### Prompt — Phase 3 (ML Core)
```
You are a Lead ML Engineer in wearable + vision motion modeling. Context: MOVA's LIMU-BERT encoder + Lightning
training stack exist and run on Apple-Silicon MPS (see master document, Part 1.4).
Task: Take the models to production: self-supervised pretraining (masked + contrastive); fine-tune FoG / HAR /
movement-quality heads; evaluate with LOSO-CV and cross-device/position protocols; implement IMU<->vision
fusion and virtual-IMU synthesis; export ONNX; register checkpoints + model cards; build the benchmark harness
that emits results for the Benchmark page.
Output: trained checkpoints, a metrics report (AUROC/AUPRC/sensitivity@specificity for FoG via LOSO-CV;
macro-F1 + generalization tables for HAR), ONNX artifacts, model cards, and the benchmark JSON. Be honest
about numbers and failure modes.
Rules: no AI signatures; commit as k4ssymzhomart.
```

### Prompt — Phase 4 (CV "Spider-Web" Engine)
```
You are an Expert Real-Time Computer-Vision Engineer. Context: MOVA needs an on-device markerless pose engine
with a "spider-web" overlay that hugs each limb and scores movement live, fused with IMU (master document,
Phase 4).
Task: Implement the in-browser pose pipeline (MediaPipe Tasks via WASM/WebGPU), landmark smoothing, A-pose
calibration, per-frame joint-angle extraction, occlusion/confidence handling, the spider-web renderer with
in-range/limit/compensation color states, and the IMU-fusion runtime. Raw video must never leave the client.
Output: the pose-engine module, the overlay component, a calibration flow, a latency report (<50 ms/frame
target), and a short validity note comparing extracted angles to a reference for >=2 joints.
Rules: no AI signatures; commit as k4ssymzhomart.
```

### Prompt — Phase 5 (Rehab & Gamification Engine)
```
You are a Senior Game/Interaction Engineer with rehabilitation-science literacy. Context: MOVA gamifies
prescribed rehab, driven by the fused motion stream (master document, Phase 5).
Task: Build the gamification runtime (three.js; WebXR-optional) with exercise primitives (reach-to-target,
grasp-and-release, sit-to-stand, balance-hold, head-tracking), per-exercise clinical scoring rubrics,
difficulty/dose adaptivity, and safety rails. Author two exercise packs: upper-limb reaching and gait/balance.
Implement the rule-based prescription engine (intake profile -> pack + difficulty + dose).
Output: the game runtime, two exercise packs with scoring rubrics, the adaptivity logic, the prescription
engine, and a session-summary screen. Each game must map to a validated clinical metric.
Rules: no AI signatures; commit as k4ssymzhomart.
```

### Prompt — Phase 6 (Identity, Personalization & Onboarding)
```
You are a Full-Stack Product Engineer focused on onboarding and healthcare integration. Context: MOVA needs an
authenticated, consented, personalized intake with a mock medical-center linkage (master document, Phase 6).
Task: Implement Supabase auth + RLS-backed sessions; a <=2-minute conversational intake (condition, side,
goals, pain, schedule, equipment) with progressive disclosure and save-resume; a 60-second CV-guided baseline
ROM assessment; consent capture + audit; and a FHIR-shaped mock integration (Patient/Practitioner/CarePlan/
Observation/Consent) behind an adapter interface.
Output: auth + intake flows, the baseline-assessment capture, the prescription record, and the mock-FHIR
CarePlan round-trip — all working end to end on mock data.
Rules: no AI signatures; commit as k4ssymzhomart.
```

### Prompt — Phase 7 (Clinician & Medical-Center Portal)
```
You are a Senior Full-Stack Engineer building clinical dashboards. Context: clinics are MOVA's B2B2C buyer
(master document, Phase 7).
Task: Build the clinician portal (patient roster, session replay, ROM/gait/FoG trend charts, prescription
editor), the mock-FHIR CarePlan/Observation exchange, and exportable PDF outcome reports. Enforce clinic
scoping via RLS and surface "decision support, not diagnosis" throughout.
Output: the clinician portal, the mock-FHIR exchange surface, and the report generator, demonstrated on mock
data (a clinician reviews a session, edits a prescription, exports a report).
Rules: no AI signatures; commit as k4ssymzhomart.
```

### Prompt — Phase 8 (Content & Education Platform)
```
You are a Content-Platform Engineer and technical writer. Context: MOVA's five surfaces (Model, Datasets,
Benchmark, Research, Docs) must each render from a real artifact in a monochrome reading experience (master
document, Part 2 and Phase 8).
Task: Build the content pipeline and pages: Model (card + live metrics), Datasets (schema + dataset cards),
Benchmark (live leaderboard from the eval harness), Research (cited library; link + summarize + BibTeX, never
host PDFs), Docs (OpenAPI + schema + guides). Use the reading layout (KaTeX, monochrome code, auto TOC,
reading progress, citations).
Output: the five content-backed pages, the citation/BibTeX components, and the benchmark renderer reading the
eval-harness output. Nothing hand-typed that should come from an artifact.
Rules: no AI signatures; commit as k4ssymzhomart.
```

### Prompt — Phase 9 (Design System & Frontend Experience)
```
You are an Expert UI/UX Designer and Design-Systems Engineer. Context: MOVA must feel like one product across
landing, app, console, and reading surfaces, in a Vercel-native monochrome aesthetic (master document, Part 2
and Phase 9).
Task: Build a token-driven monochrome design system (sharp geometry, minimal rounding 0-4px, hairlines, the
type system) as a reusable component library; refactor the landing, app shell, clinician console, and reading
layout to consume it; ensure WCAG accessibility, i18n-readiness, and responsiveness; add Playwright E2E for the
core journeys.
Output: the design-system package + tokens, the refactored surfaces, an accessibility report, and green E2E.
Rules: no AI signatures; commit as k4ssymzhomart.
```

### Prompt — Phase 10 (Security/Compliance, MLOps & Clinical Validation)
```
You are a Staff MLOps + Security Engineer with clinical-validation experience. Context: MOVA will process real
PHI and must prove clinical validity (master document, Phase 10).
Task: Establish the PHI posture (encryption, RLS isolation, audit, consent, retention/erasure, HIPAA/GDPR
review), secrets management, CI (lint/type/test), container builds, IaC, observability, and data/model drift
monitoring with retrain triggers. Design and (where data allows) run a clinical validation study: fused
kinematics vs clinician goniometry/mocap, and LOSO-CV for FoG; plus an adherence pilot design.
Output: a compliance checklist, CI/CD + monitoring config, the drift->retrain loop, and a validation-study
report with honest metrics feeding the Benchmark/Research pages.
Rules: no AI signatures; commit as k4ssymzhomart.
```

---

# Part 5 — Strict Operating & Git Rules

1. **No AI signatures, anywhere.** Never add "Generated by …", "AI-generated", "Co-Authored-By: …", robot
   emojis, or any machine-authorship metadata to code, comments, commit messages, PR descriptions, or docs.
   The repository must read as entirely human-authored by the founder.
2. **Commit identity.** All commits are authored as **`k4ssymzhomart`** (`kassymzhomart.shubay@nu.edu.kz`).
   Commit messages are plain, conventional, and signature-free.
3. **Branch discipline.** Feature branches per phase (`feature/<phase>`); never commit directly to a shared
   default branch without intent; open PRs for review when asked.
4. **Honesty doctrine.** Report real metrics and failure modes. In clinical ML, evaluation design (splits,
   leakage, LOSO-CV) outranks any single accuracy number. Never present a misleading score as a win.
5. **Privacy & compliance.** Raw video stays on-device; PHI is isolated via RLS; secrets never enter the repo;
   external papers are linked, not mirrored.
6. **Source of truth.** This document is the canonical plan. Update it when decisions change; keep
   `docs/research_library.md` and the roadmap in sync.
