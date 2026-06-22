# MOVA — Master Project Document (v2, full ecosystem)

**Type:** Product Requirements Document + Technical Specification + Information Architecture.
**Audience:** the founder/orchestrator (vision) and the execution agent (build).
**Status:** living source of truth that survives session resets.

> How to use: Part 1 = story + ML core + current results. Part 2 = the whole product ecosystem (surfaces,
> navigation, every page). Part 3 = design system. Part 4 = gamification. Part 5 = CV/game engine. Part 6 =
> data model. Part 7 = the 10 macro-phases (each owns a slice of the ecosystem). Part 8 = a copy-paste
> execution prompt per phase. Part 9 = operating rules.

## Contents
1. Story, current state & the ML core (with real FoG results)
2. The product ecosystem — surfaces, navigation, every page
3. Design system (Vercel-native monochrome)
4. Gamification & engagement ecosystem
5. CV "spider-web" capture + rehab game engine
6. Data model (Supabase) & services
7. The 10 macro-phases (explicit deliverables)
8. Execution prompts (one per phase)
9. Operating & Git rules

---

# Part 1 — Story, current state & the ML core

## 1.1 Mission
MOVA turns **1–2 low-cost inertial sensors + an ordinary camera** into **clinical-grade motion intelligence
for rehabilitation** — joint angles, movement quality, balance, and freezing-of-gait, measured at home,
**camera-optional and privacy-first**, with a model that **generalizes across patients, devices, and sensor
placements**. Wrapped in a **gamified rehab experience** that drives adherence. *mova = movement.*

## 1.2 Problem & wedge
Rehab outcomes (ROM, compensation, balance, gait) are still measured by eye or $50k lab mocap. IMUs + markerless
vision can measure them objectively *if the model generalizes* — the open problem. Market: tele-rehab/digital-MSK
~$5.4B (2024) → ~$15B (2032); Sword Health ($4B) bought Kaia ($285M, Jan 2026). **Wedge:** camera-optional,
consumer sparse sensors, on-device privacy, body-agnostic model — cheaper, private, deployable anywhere.

## 1.3 Story so far
Direction (generalizable motion model) → canonical IMU schema + adapters (HHAR, Daphnet-FoG, REALDISP) →
50 Hz pipeline → **672,221 subject-disjoint windows** → LIMU-BERT encoder + Lightning SSL/FoG/HAR module →
FastAPI + TimescaleDB backend with a Bachlin-Freeze-Index mock → Next.js landing + clinician console →
**local-training pivot** to Apple-Silicon MPS (GPU cluster fell through) → caught & fixed a split bug that had
faked 98.6% accuracy → first **honest FoG result** (below).

## 1.4 The ML core (defined by the ML lead)

MOVA is a **multi-task, multi-modal motion engine** fusing **inertial (IMU)** and **markerless vision (pose)**.

### 1.4.1 Tasks & current models
| Task | Modality | Status |
|---|---|---|
| Freezing-of-gait (FoG) | IMU (+pose) | baseline trained locally (results below) |
| Human activity recognition (HAR) | IMU | head implemented; eval pending |
| Movement-quality / compensation | pose (+IMU) | designed; needs KIMORE/UI-PRMD |
| Joint-angle / ROM | pose+IMU fusion | designed |
| 3D pose / sparse-IMU pose | pose; IMU roadmap | designed (AMASS/DIP/TotalCapture) |

### 1.4.2 Current FoG result — honest baseline (freeze-stratified, subject-disjoint test = S08)
```
accuracy 0.678 · balanced_acc 0.527 · macro_f1 0.525
sensitivity 0.210 · specificity 0.845 · precision 0.325 · AUROC 0.551
confusion: tn 1447 · fp 266 · fn 481 · tp 128
```
**Interpretation:** AUROC 0.55 ≈ near chance; the model misses ~79% of freezes. This is a *from-scratch,
12-epoch, single-held-out-subject* baseline — exactly what the rest of the program exists to beat. **Do not
present this as a success.**

**Why it's weak (root causes):** (1) no self-supervised pretraining yet; (2) only 12 epochs, small encoder
(hidden 192); (3) evaluated on **one** subject → high variance, not representative; (4) plain cross-entropy
despite imbalance; (5) Daphnet is **accelerometer-only**, so the gyro half of the 6-channel input is
zero-filled; (6) no decision-threshold tuning (default 0.5).

**The path to thesis-grade FoG (target AUROC ≥ 0.88, sensitivity ≥ 0.85 @ specificity ≥ 0.85):**
1. **SSL pretrain** the encoder on all 672k windows (masked + contrastive), then fine-tune FoG.
2. **LOSO-CV** over the 8 freeze-positive subjects; report **mean ± std** (one subject is not an evaluation).
3. **Class-weighted / focal loss** + keep the imbalance sampler; tune the decision threshold on validation to
   hit a target operating point (sensitivity@specificity).
4. **Daphnet-aware input:** an accelerometer-only variant or explicit missing-gyro handling; add the **Bachlin
   Freeze-Index** as an engineered input channel and as the baseline to beat.
5. Bigger encoder + more epochs; augmentation (jitter/scale/time-warp); **event-level** smoothing
   (windows → episodes) for clinical metrics.

### 1.4.3 Metrics doctrine (apply to every model)
Always **subject-disjoint**; **LOSO-CV** for small clinical sets; report the generalization axes the thesis is
about — **cross-subject, cross-device (HHAR), cross-position (REALDISP ideal→self→mutual)**. FoG primary =
AUROC + AUPRC; HAR = macro-F1 (target ≥0.90 in-distribution) + quantified cross-device/position drop;
movement-quality = correlation ≥0.7 with clinician scores, ROM MAE ≤5°; pose = MPJPE ≤~80 mm, joint-angle
MAE ≤5–8°; CV-vs-mocap r ≥0.90, fusion cuts occlusion/extreme-flexion error toward ≤8°.

### 1.4.4 Open-source datasets
IMU (have): HHAR, Daphnet-FoG, REALDISP. IMU (add): **CAPTURE-24** (SSL fuel), PAMAP2, Opportunity, MHEALTH,
MobiAct/SisFall/UMAFall, MM-Fit, WISDM. Pose+mocap (joint angles + virtual-IMU): **AMASS**, TotalCapture,
DIP-IMU, Human3.6M, 3DPW, MoVi. Rehab w/ clinician scores: **KIMORE**, **UI-PRMD**, IntelliRehabDS, REHAB24-6.

### 1.4.5 Models
IMU encoder: LIMU-BERT Transformer (have) → UniMTS-style unified pretraining; SSL = masked + contrastive
(RelCon). Vision: **MediaPipe BlazePose/Hands/FaceMesh** (on-device runtime), MoveNet (light), MMPose/ViTPose
(offline accuracy), MotionBERT (2D→3D + mesh). Quality: ST-GCN/DG-STGCN on skeleton. Fusion: complementary
filter or cross-modal Transformer + virtual-IMU (IMUTube/Wonderwall/Vsens) for the flywheel.

### 1.4.6 Data flywheel
Each session yields synced pose+IMU → synthesize virtual-IMU → improve the IMU encoder (gated by held-out
validation). Every session both treats the patient and improves the model — the moat.

## 1.5 Locked decisions
Canonical IMU schema; 50 Hz / 4 s / 6-channel windows + placement/dataset conditioning; subject-disjoint &
LOSO eval; freeze-stratified clinical splits; SSL-first; **on-device CV** (raw video never leaves client);
fusion over single-modality; mock-but-real FHIR integration; **Supabase** app backend + **separate Python ML
inference microservice**; monochrome design system.

---

# Part 2 — The product ecosystem (surfaces, navigation, every page)

MOVA is **four surfaces** sharing one design system:
**A) Marketing site** · **B) Patient app** · **C) Clinician portal** · **D) Admin console.**

## 2.A Marketing site (public)
- **Top nav:** `Product ▾` (How it works · For patients · For clinics), `Model`, `Datasets`, `Benchmark`,
  `Research`, `Docs`, `Pricing`, `Sign in`, **`Get started`** (primary).
- **Pages:** Home (scroll narrative) · How it works · For patients · For clinics · **Model** (card + live
  metrics) · **Datasets** (schema + dataset cards) · **Benchmark** (live leaderboard) · **Research** (cited
  library) · **Docs** (API/schema/guides) · Pricing · About · Legal (Privacy, Terms, HIPAA/GDPR) · Contact.
- All Model/Datasets/Benchmark/Research/Docs pages use the **reading layout** (Part 3.6) and render from real
  artifacts (Phase 8).

## 2.B Patient app (authenticated) — the LEFT SIDEBAR
A persistent **left nav** (collapsible, icon+label, monochrome). Top: workspace switcher + patient name.
Items, each a page:

1. **Today** (Home) — the hero CTA "Start today's session," streak ring, next milestone, quick stats
   (adherence %, ROM trend sparkline), recovery-story progress, reminders.
2. **My Program** — the prescribed plan: weekly schedule calendar, goals (per joint/function), exercise list
   with status, expected dose, clinician note. Edit-request flow.
3. **Train** (Live Session) — the camera/game surface: device check → A-pose **calibration** → the
   **spider-web** overlay → the gamified exercise → real-time feedback → session summary. (Part 5.)
4. **Exercises** (Library) — browse exercise packs; each exercise has an explainer (animation/loop), target
   muscles/joints, difficulty, safety notes, "add to program" (request).
5. **Progress** — analytics dashboards: ROM-over-time per joint, adherence heatmap, smoothness/symmetry
   trends, freeze-episode timeline, session history with replays; export.
6. **Achievements** — gamification: level + XP, badges, streaks, daily/weekly goals, opt-in clinic
   leaderboard, recovery "journey map." (Part 4.)
7. **Devices** — pair IMU over Web Bluetooth, sensor battery/placement status, camera selection + calibration,
   connectivity diagnostics, privacy indicator (on-device).
8. **Care Team** — messages/chat with clinician, scheduled video visits, shared notes, consent status.
9. **Learn** — the education hub (papers/articles) in the monochrome reading experience; personalized to the
   patient's condition; "why this exercise works" links to evidence.
10. **Notifications** — reminders, achievements, clinician messages, schedule changes.
11. **Settings** — profile, condition/affected-side, accessibility (reduced motion, font size, contrast,
    language), privacy & consent (data, camera, sharing), connected accounts, danger zone (export/delete).
- **Footer:** Help/Support, what's-new, Sign out. **Top bar:** search, notifications bell, streak, avatar menu.

## 2.C Clinician portal (authenticated) — left nav
1. **Overview** — clinic dashboard: active patients, today's sessions, **alerts** (missed sessions, FoG
   spikes, declining ROM), adherence summary, caseload health.
2. **Patients** — roster with filters (condition, risk, adherence, clinician), risk flags, search; bulk
   actions.
3. **Patient detail** — profile + program + **session review** (replay with spider-web + metrics) + trend
   charts (ROM/gait/FoG/adherence) + clinical notes + **prescription editor** (assign packs, set
   targets/dose/schedule) + messages + consent/FHIR status.
4. **Sessions** — review queue, flagged/abnormal sessions, sign-off workflow.
5. **Programs** — prescription templates, the exercise library, protocol builder, evidence references.
6. **Outcomes & Reports** — population analytics, cohort comparisons, exportable **PDF outcome reports**,
   FHIR sync status.
7. **Messages** — patient threads, broadcast, visit scheduling.
8. **Clinic Settings** — team & roles (RBAC), EHR/FHIR integration, branding, billing, audit log access.

## 2.D Admin console
Tenants/clinics, users & roles, **content management** (papers/model-cards/dataset-cards/docs), **model
registry & benchmark** publishing, feature flags, audit logs, system health/observability, data-retention
controls.

---

# Part 3 — Design system (Vercel-native monochrome)

- **Color:** strict monochrome. Ink scale (`#0a0a0a → #6b7280 → #e5e5e5` on `#ffffff`; inverted dark mode),
  one faint hairline `rgba(0,0,0,0.08)`, **one** restrained accent reserved for links/active/primary only. No
  decorative color, no gradients, no shadows beyond a whisper.
- **Geometry:** sharp, geometric, **minimal rounding (0–4px)**; squared cards; 1px hairline dividers.
- **Type:** Geist Sans (prose) + Geist Mono (code/metadata/metrics); tight heading tracking; body line-height
  ~1.7; reading measure ~68ch.
- **Spacing/grid:** 4px base scale; 12-col responsive; generous whitespace.
- **Motion:** near-none; subtle fade/translate on scroll; honor `prefers-reduced-motion`.
- **Core components:** AppShell (collapsible sidebar + top bar), SidebarNav, Button (primary/ghost/danger),
  Card (squared), StatTile, Chart (monochrome line/area/bar/heatmap), DataTable, Tabs, Modal/Sheet, Toast,
  Badge, Avatar, ProgressRing, Stepper (intake), DevicePairing, ChatThread, VideoCall, **SpiderWebCanvas**,
  **GameStage**, ReadingLayout (sticky TOC + reading-progress + citations + KaTeX + monochrome code),
  Skeletons, EmptyStates, Forms.
- **Accessibility:** WCAG AA, keyboard-first, focus rings, captions, i18n-ready (EN/RU/KK).

## 3.6 Reading/education layout
Single centered column; sticky TOC rail; thin reading-progress bar; right-margin footnotes/citations; KaTeX
math; monochrome code; citation components from `references.bib`. **Legal rule:** external papers are
cite+link+summarize+BibTeX — **never host copyrighted PDFs**.

---

# Part 4 — Gamification & engagement ecosystem
Adherence is the clinical failure point; gamification (RCT-backed) fixes it.
- **XP & levels:** points per completed rep/session weighted by quality; levels unlock packs/themes.
- **Streaks & goals:** daily streaks, weekly dose goals, progress rings; gentle recovery (streak freeze).
- **Badges/achievements:** milestones (first session, 7/30-day streak, ROM goal reached, 100 quality reps,
  beat-your-best smoothness).
- **Recovery journey/story mode:** the program rendered as a map; exercises are stages with narrative.
- **Leaderboards:** opt-in, clinic-internal, privacy-safe (no PHI), relative-progress not raw scores.
- **Adaptive challenge:** difficulty/dose auto-tunes from performance to stay in the motivating zone.
- **Nudges:** reminders, smart notifications, clinician kudos, celebratory micro-moments — all within the
  monochrome aesthetic (restraint over confetti).
- **Everything maps to a clinical metric** — engagement never overrides therapy or safety.

---

# Part 5 — CV "spider-web" capture + rehab game engine
- **On-device pose:** MediaPipe Tasks (Pose 33 / Hands 21 / Face) via WASM/WebGPU; landmark smoothing; **raw
  video never leaves the client** (only keypoints/metrics).
- **Calibration:** A-pose + camera distance/FOV + per-user limb lengths; visibility/occlusion confidence.
- **Spider-web overlay:** luminous skeleton edges + translucent segment ribbons triangulated between landmarks
  that deform per frame to *embrace* the limb; color states in-range/near-limit/compensation.
- **Kinematics:** per-frame joint angles (ROM), angular velocity, jerk/smoothness, symmetry, trunk
  compensation, rep segmentation/count.
- **Fusion:** weight shifts to IMU when CV confidence drops or the joint enters extreme flexion (CV's known
  failure mode); output is one fused kinematic stream consumed by the game and the model.
- **Game engine:** three.js (WebXR-optional); pose drives avatar/cursor; primitives — reach-to-target,
  grasp-and-release, sit-to-stand, balance-hold, head-tracking; per-exercise clinical scoring rubric;
  difficulty/dose adaptivity; safety rails (pain/stop, fatigue); session summary → metrics persisted.
- **Exercise packs (ship order):** (1) upper-limb reaching — richest CV evidence; (2) gait/balance — matches
  the FoG model; then hand grasp, head/neck, sit-to-stand/lower-limb.

---

# Part 6 — Data model (Supabase) & services
**Postgres (RLS-isolated, clinic-scoped):** `profiles`, `clinics`, `clinicians`, `patients`,
`care_team_links`, `conditions`, `goals`, `exercises`, `exercise_packs`, `prescriptions`, `programs`,
`schedules`, `sessions`, `session_metrics`, `session_frames` (time-series, Timescale/partitioned),
`fog_events`, `rom_measurements`, `achievements`, `xp_ledger`, `streaks`, `messages`, `notifications`,
`consents`, `content` (papers/cards/docs), `references` (BibTeX), `audit_log`, `model_registry`,
`benchmark_runs`.
**RLS:** patient → own rows; clinician → assigned patients; clinic-scoped; admin → tenant-scoped. Auth =
Supabase (email/OAuth/MFA). Storage = session artifacts, model cards, dataset manifests. Realtime = live
session/clinician view. **ML inference = separate Python service** (FastAPI + ONNX/Triton) — fusion + model +
metrics; Supabase ↔ inference via signed requests + a typed contract. Edge Functions for light logic.

---

# Part 7 — The 10 macro-phases (explicit deliverables)
Each phase owns concrete pages/services/components. Critical path 1→7; 8–9 run alongside from Phase 3; 10 is
cross-cutting.

### Phase 1 — Foundational Architecture & Supabase Backend
Build: Supabase project; full schema + migrations; RLS policy matrix (role×table×op); Auth (email/OAuth/MFA);
Storage buckets; Realtime channels; the Supabase↔Python-inference contract; environments dev/staging/prod;
seed data. **DoD:** a patient + clinician can be created, isolated by RLS, with auth working end to end.

> **Status (delivered on `feature/phase-1-supabase-backend`):** `supabase/` project with 16 migrations
> (`0001`–`0016`) covering all Part-6 tables, enums + the body-site ontology, `app.*` SECURITY-DEFINER RLS
> helpers, the full RLS matrix, audit triggers, storage buckets, the realtime publication, the new-user +
> custom-access-token auth hooks, and `inference_jobs`. Plus `supabase/seed.sql` (demo clinic/clinician/patient
> + the honest FoG baseline), pgTAP isolation tests (`supabase/tests/`), the typed inference contract
> (`contracts/inference/v1/`: JSON-Schema source of truth + Pydantic + TS + HMAC signing), and docs
> (`docs/PHASE_1_RLS_MATRIX.md`, `docs/PHASE_1_ERD.md`, `supabase/README.md`). Every SQL artifact is
> syntax-validated against the PostgreSQL grammar via `scripts/db/validate_sql.py`. **Pending live verify:**
> `supabase db reset` + `supabase test db` need Docker + the Supabase CLI (unavailable in the build env).

### Phase 2 — Data Platform & Pipelines
Build: keep canonical schema + adapters; DVC versioning; adapters for CAPTURE-24, AMASS, KIMORE/UI-PRMD,
TotalCapture/DIP-IMU; pose-capture feature pipeline; frozen subject-disjoint + LOSO split artifacts; the
flywheel ETL (session pose+IMU → virtual-IMU → gated shards); dataset cards. **DoD:** reproducible from one
command; leakage = 0; data cards published.

> **Status (delivered on `feature/phase-2-data-platform`):** canonical schema extended (6 new dataset specs +
> pose schema); 6 new adapters (CAPTURE-24, AMASS via SMPL→virtual-IMU in `synth/`, KIMORE, UI-PRMD,
> TotalCapture, DIP-IMU with orientation→derived-gyro); pose feature pipeline (`pose/`: joint angles, ROM,
> LDLJ smoothness, symmetry); `preprocess/loso.py` (LOSO folds) + `data/leakage.py` (the leakage=0 gate);
> `flywheel/etl.py` (session pose → gated virtual-IMU); the reproducible DAG (`dvc.yaml` + `params.yaml`); and
> 9 dataset cards. Verified end-to-end on synthetic fixtures (`tests/fixtures/make_fixtures.py`, 11 pytest):
> 7 IMU datasets → 543 windows, subject-disjoint + LOSO, **leakage_free=true**; pose features + flywheel run.
> See `docs/PHASE_2_DATA_PLATFORM.md`. **Pending live run:** `dvc pull` + `dvc repro` need the license-gated
> raw datasets (AMASS/DIP/CAPTURE-24/…) — new adapters carry `format_verified_against_real_data: false`.

### Phase 3 — Motion-Intelligence ML Core
Build: SSL pretrain (masked+contrastive) on 672k windows; fine-tune FoG/HAR/quality with **LOSO-CV** +
class-weighting + threshold tuning; IMU↔vision fusion; virtual-IMU generator; ONNX export; model registry +
model cards; benchmark harness emitting the leaderboard JSON. **DoD:** FoG **beats the 0.55 baseline** toward
target, reported as LOSO mean±std with honest failure analysis; metrics flow to the Benchmark page.

### Phase 4 — Real-Time CV "Spider-Web" Engine
Build: on-device pose pipeline, smoothing, A-pose calibration, joint-angle extraction, occlusion confidence,
the spider-web renderer, IMU-fusion runtime; the **Train/Live Session** page; **Devices** page (BLE pairing +
camera calibration). **DoD:** live camera → stable web → numeric joint angles in a documented error band → rep
counts; <50 ms/frame; raw video stays on-device.

### Phase 5 — Rehabilitation & Gamification Engine
Build: game runtime + exercise primitives; two exercise packs (reaching, gait/balance) with clinical rubrics;
difficulty/dose adaptivity; safety rails; the rule-based prescription engine; the **Achievements**, **My
Program**, **Exercises** pages; the gamification ecosystem (Part 4). **DoD:** a prescribed patient completes a
full gamified session; scores persist; difficulty adapts; achievements fire.

### Phase 6 — Identity, Personalization & Onboarding
Build: Supabase auth + RLS sessions; the conversational ≤2-min **intake stepper**; the 60-sec CV-guided
baseline ROM assessment; consent capture + audit; the **Settings** page; the FHIR-shaped mock
(Patient/Practitioner/CarePlan/Observation/Consent) behind an adapter. **DoD:** new patient signs up →
intake → linked to a mock clinic/clinician → personalized "Today" — fully working on mock data.

### Phase 7 — Clinician & Medical-Center Portal
Build: the clinician surface (Overview, Patients, Patient detail with session replay + trends + prescription
editor, Sessions, Programs, Outcomes & Reports, Messages, Clinic Settings); mock-FHIR CarePlan/Observation
round-trip; PDF outcome reports; "decision support, not diagnosis" everywhere; RLS clinic scoping. **DoD:** a
clinician reviews a real (mock-data) session, edits a prescription, exports a report; FHIR round-trips.

### Phase 8 — Content & Education Platform
Build: the content pipeline + the **Model / Datasets / Benchmark / Research / Docs** pages and the patient
**Learn** hub, all in the reading layout, from real artifacts (model cards, dataset cards, eval-harness
leaderboard, cited library, OpenAPI). **DoD:** every surface renders from a source of truth; benchmark numbers
auto-update; nothing hand-typed that should be generated; no hosted PDFs.

### Phase 9 — Design System & Frontend Experience
Build: the token-driven monochrome design system as a component library; refactor marketing, app shell,
clinician portal, and reading layout to consume it; AppShell + SidebarNav + all core components; WCAG, i18n
(EN/RU/KK), responsive; Playwright E2E of core journeys. **DoD:** one coherent system across all surfaces;
green E2E; accessibility report passes.

### Phase 10 — Security/Compliance, MLOps & Clinical Validation
Build: PHI posture (encryption, RLS isolation, audit, consent, retention/erasure, HIPAA/GDPR review); secrets
mgmt; CI (lint/type/test); container builds; IaC; observability; data/model drift → retrain triggers; a
clinical validation study (fused kinematics vs goniometry/mocap; FoG LOSO-CV) + an adherence pilot. **DoD:**
documented path to handle real PHI; green CI; monitoring live; a validation report with honest metrics.

---

# Part 8 — Execution prompts (one per phase)
Paste into a fresh session and attach this document. Every prompt assumes Part 9 (no AI signatures; commit as
`k4ssymzhomart`) and the honesty doctrine.

### Phase 1 — Supabase backend
```
Role: Principal Backend Architect (Supabase, multi-tenant healthcare). Context: MOVA is a CV+IMU tele-rehab
platform; see MOVA_MASTER_DOCUMENT.md (Parts 1, 2.B/2.C, 6). Task: implement the Supabase foundation — full
Postgres schema + migrations (all tables in Part 6), the RLS policy matrix (patient/clinician/clinic/admin),
Auth (email/OAuth/MFA), Storage buckets, Realtime channels, and the typed contract to the Python inference
service. Output: SQL migrations (Supabase CLI), an RLS matrix table, an ERD description, the bucket layout, and
a local-run README; verify migrations apply cleanly. Rules: no AI signatures; commit as k4ssymzhomart.
```
### Phase 2 — Data platform
```
Role: Senior ML Data Engineer. Context: MOVA has a 50 Hz IMU pipeline (672k windows) and must add vision/pose
+ the flywheel (Parts 1.4, 5, 6). Task: generalize the data platform — keep canonical schema + adapters; add
DVC; write adapters for CAPTURE-24, AMASS, KIMORE/UI-PRMD, TotalCapture/DIP-IMU; build the pose feature
pipeline; freeze subject-disjoint + LOSO split artifacts; implement the flywheel ETL. Output: adapters, a DVC
pipeline, split/normalization manifests, per-dataset data cards; re-run end to end and report window/leakage
stats. Rules: no AI signatures; commit as k4ssymzhomart.
```
### Phase 3 — ML core
```
Role: Lead ML Engineer (wearable + vision motion). Context: LIMU-BERT encoder + Lightning stack run on MPS;
current FoG baseline AUROC 0.55 (Part 1.4.2). Task: SSL pretrain (masked+contrastive) on 672k windows;
fine-tune FoG/HAR/quality with LOSO-CV + class-weighting + threshold tuning; implement fusion + virtual-IMU;
export ONNX; register checkpoints + model cards; build the benchmark harness. Output: checkpoints, an honest
metrics report (FoG AUROC/AUPRC/sensitivity@specificity via LOSO-CV mean±std; HAR macro-F1 + generalization
tables), ONNX, model cards, benchmark JSON. Beat the 0.55 baseline and explain remaining failure modes. Rules:
no AI signatures; commit as k4ssymzhomart.
```
### Phase 4 — CV spider-web engine
```
Role: Expert Real-Time Computer-Vision Engineer. Context: on-device pose + spider-web + IMU fusion (Part 5).
Task: implement the in-browser pose pipeline (MediaPipe Tasks, WASM/WebGPU), smoothing, A-pose calibration,
joint-angle extraction, occlusion confidence, the spider-web renderer (in-range/limit/compensation states),
and the IMU-fusion runtime; build the Train/Live-Session page and the Devices page (BLE + camera calibration).
Raw video must never leave the client. Output: the pose-engine module, overlay, calibration flow, a <50 ms
latency report, and a validity note (≥2 joints vs reference). Rules: no AI signatures; commit as k4ssymzhomart.
```
### Phase 5 — Rehab & gamification
```
Role: Senior Game/Interaction Engineer (rehab-science literate). Context: gamified rehab on the fused motion
stream (Parts 4, 5). Task: build the game runtime + exercise primitives; two packs (reaching, gait/balance)
with clinical rubrics; adaptivity; safety rails; the prescription engine; and the My Program, Exercises, and
Achievements pages + the gamification ecosystem. Output: game runtime, two packs, adaptivity logic,
prescription engine, session summary; each game maps to a validated clinical metric. Rules: no AI signatures;
commit as k4ssymzhomart.
```
### Phase 6 — Onboarding & personalization
```
Role: Full-Stack Product Engineer (onboarding + healthcare integration). Context: personalized intake + mock
FHIR (Part 2.B, Phase 6). Task: Supabase auth + RLS sessions; the ≤2-min conversational intake stepper; the
60-sec CV-guided baseline ROM assessment; consent + audit; Settings page; the FHIR-shaped mock behind an
adapter. Output: auth + intake flows, baseline capture, prescription record, mock-FHIR CarePlan round-trip —
working on mock data. Rules: no AI signatures; commit as k4ssymzhomart.
```
### Phase 7 — Clinician portal
```
Role: Senior Full-Stack Engineer (clinical dashboards). Context: Part 2.C, Phase 7. Task: build Overview,
Patients, Patient detail (session replay + trends + prescription editor), Sessions, Programs, Outcomes &
Reports, Messages, Clinic Settings; mock-FHIR CarePlan/Observation exchange; PDF outcome reports; RLS clinic
scoping; "decision support, not diagnosis." Output: the clinician portal + mock-FHIR exchange + report
generator, demonstrated on mock data. Rules: no AI signatures; commit as k4ssymzhomart.
```
### Phase 8 — Content & education
```
Role: Content-Platform Engineer + technical writer. Context: Parts 2.A, 3.6, Phase 8. Task: build the content
pipeline and the Model, Datasets, Benchmark, Research, Docs pages + the patient Learn hub in the monochrome
reading layout, all from real artifacts (model cards, dataset cards, eval-harness leaderboard, cited library +
BibTeX, OpenAPI). Output: the content-backed pages + citation components + benchmark renderer; no hosted PDFs;
nothing hand-typed that should be generated. Rules: no AI signatures; commit as k4ssymzhomart.
```
### Phase 9 — Design system & frontend
```
Role: Expert UI/UX Designer + Design-Systems Engineer. Context: Vercel-native monochrome across all surfaces
(Part 3). Task: build the token-driven monochrome design system as a component library; refactor marketing,
app shell, clinician portal, reading layout to consume it; AppShell + SidebarNav + all core components; WCAG,
i18n (EN/RU/KK), responsive; Playwright E2E. Output: the design-system package + tokens, refactored surfaces,
an accessibility report, green E2E. Rules: no AI signatures; commit as k4ssymzhomart.
```
### Phase 10 — Security/MLOps/validation
```
Role: Staff MLOps + Security Engineer (clinical validation). Context: Phase 10. Task: PHI posture (encryption,
RLS isolation, audit, consent, retention/erasure, HIPAA/GDPR), secrets mgmt, CI (lint/type/test), container
builds, IaC, observability, drift→retrain; design + (where data allows) run a validation study (fused
kinematics vs goniometry/mocap; FoG LOSO-CV) + adherence pilot. Output: compliance checklist, CI/CD +
monitoring, drift→retrain loop, a validation report with honest metrics feeding Benchmark/Research. Rules: no
AI signatures; commit as k4ssymzhomart.
```

---

# Part 9 — Strict operating & Git rules
1. **No AI signatures anywhere** — never add "Generated by…", "AI-generated", "Co-Authored-By:", robot emoji,
   or any machine-authorship metadata to code, comments, commits, PRs, or docs. The repo must read as
   entirely human-authored.
2. **Commit identity:** all commits authored as **`k4ssymzhomart`** (`kassymzhomart.shubay@nu.edu.kz`); plain,
   signature-free messages.
3. **Branch discipline:** feature branch per phase (`feature/<phase>`); PRs for review when asked.
4. **Honesty doctrine:** report real metrics + failure modes; evaluation design (splits, leakage, LOSO-CV)
   outranks any single number; never present a misleading score as a win (see the FoG baseline).
5. **Privacy & compliance:** raw video stays on-device; PHI isolated via RLS; secrets never in the repo;
   external papers linked, never mirrored.
6. **Source of truth:** this document. Keep it, `docs/research_library.md`, and the roadmap in sync.
