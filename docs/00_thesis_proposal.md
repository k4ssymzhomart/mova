# Mova — Thesis Proposal / Research Plan

**Working title:** *Mova: A Generalizable Self-Supervised Motion Foundation Model for IMU-Based
Rehabilitation — Joint-Angle, Movement-Quality, and Balance Estimation that Transfers Across Patients,
Sensor Placements, and Devices.*

**Author:** Kassymzhomart Shubay (Nazarbayev University) · **Type:** MSc/PhD thesis (multi-month) ·
**Compute:** personal / cloud GPU.

---

## 1. Problem & motivation

Wearable Inertial Measurement Units (IMUs: 3-axis accelerometer + gyroscope, often + magnetometer) can, in
principle, measure the things physiotherapy cares about — **joint angles / range of motion (ROM)**,
**movement quality** (compensations, asymmetry, smoothness), and **balance / fall risk** — at home, cheaply,
continuously. In practice three things block clinical use:

1. **Label scarcity.** Ground truth for joint angles needs optical mocap (~$50k, lab-only); clinical scores
   (Berg Balance Scale, Timed-Up-and-Go) need a clinician. Labeled rehab data is tiny.
2. **The generalization gap (the core problem).** Models trained on a cohort fail when you change the
   **person** (patients move differently from healthy subjects), the **sensor position** (a patient won't
   place a band exactly where the lab did), or the **device** (phone A's IMU ≠ watch B's IMU). This is the
   central thesis of the companion survey, *Towards Generalizable HAR* (arXiv:2508.12213).
3. **Cost/usability.** Research-grade systems use 6–17 IMUs; a home patient will tolerate 1–3.

**Thesis bet:** the way out is **self-supervised pretraining of a motion foundation model** on large
unlabeled real IMU data **plus physics-synthesized IMU data from optical mocap (AMASS)**, then fine-tuning
small clinical heads with few labels. Synthetic IMU gives *exact* joint-angle ground truth at unlimited
scale; SSL gives representations that transfer across people/positions/devices.

## 2. Startup relevance (the "why it's a company" case)

- **Market.** Telerehabilitation: **USD 5.36B (2024) → 15.4B (2032)**, ~14% CAGR. Digital MSK care is a
  distinct, fast-growing segment.
- **Proof the model works as a business.** **Sword Health** raised to a **$4B** valuation and **acquired Kaia
  Health for $285M in Jan 2026** — explicitly unifying *wearable sensor biofeedback* + *markerless computer
  vision*. Other players: Hinge Health, Physitrack, Joint Academy, Biofourmis.
- **Mova's differentiation / wedge:**
  - **Camera-free.** Pure IMU → works in any room, preserves privacy (no video of patients undressed/at home),
    not dependent on lighting or a fixed camera position.
  - **Consumer-grade, sparse sensors.** Phone + one earbud + optional wrist/ankle band, not a 17-IMU suit.
  - **Body-agnostic generalization** is the moat: the foundation model is what lets one product fit many
    bodies and pathologies without re-collecting data per clinic.
  - **Geography.** Rural Kazakhstan / Central Asia has thin physiotherapist coverage → remote, asynchronous
    rehab with objective tracking is high-value.
- **Go-to-market:** B2B2C through physiotherapy clinics and post-op orthopedic / stroke pathways; payer/insurer
  interest in adherence + outcome data. The thesis produces the defensible core IP (the generalizable model);
  the company productizes adherence, coaching, and clinician dashboards on top.

## 3. Thesis statement & research questions

> **Statement.** A motion foundation model, pretrained self-supervisedly on real free-living IMU data combined
> with physics-synthesized IMU from optical mocap, can estimate rehabilitation-relevant kinematics
> (joint angles, movement quality, balance) from a *sparse* set of consumer IMUs, and **generalizes
> significantly better across persons, sensor positions, and devices** than supervised baselines and
> single-task models.

- **RQ1 (Representation).** Does SSL pretraining (masked reconstruction + contrastive) on real+synthetic IMU
  produce encoders that beat from-scratch supervised training on rehab tasks, especially in low-label regimes?
- **RQ2 (Synthetic-to-real).** How well do models trained on AMASS-synthesized IMU transfer to *real* IMU
  (TotalCapture, DIP-IMU)? What domain-gap mitigations (sensor noise modeling, calibration augmentation,
  bias/drift simulation) close it?
- **RQ3 (Generalization).** Quantify cross-person / cross-position / cross-device / cross-dataset transfer.
  Where does the foundation model help most, and where does it still fail?
- **RQ4 (Clinical utility).** From 1–3 IMUs, how accurately can we estimate (a) joint angles / ROM,
  (b) movement-quality / compensation, (c) balance & fall-risk surrogates (TUG/BBS) and freezing-of-gait?

## 4. Contributions (what's new / defensible)

1. A **unified self-supervised IMU encoder** pretrained on a *real + synthetic* corpus, released as a
   reproducible checkpoint for rehab tasks.
2. A **synthetic-IMU pipeline** from AMASS with realistic sensor-degradation augmentations, evaluated for
   sim-to-real transfer.
3. A **rehabilitation generalization benchmark** — cross-person/position/device/dataset protocol over the
   datasets in `01_datasets.md`, comparable to the survey's settings.
4. **Sparse-sensor clinical heads** (joint angle, movement quality, balance) with results from 1–3 IMUs and
   ablations on sensor count/placement.
5. A **product/translation chapter**: from model to a Mova MVP (architecture, clinician dashboard, regulatory
   path, GTM).

## 5. Method & system design

### 5.1 Data pipeline
- **Pretraining (unlabeled / self-supervised):** CAPTURE-24 (3,883 hrs), aggregated HAR sets via curation
  libraries (WHAR / DAGHAR / BenchHAR), **+ synthetic IMU from AMASS**.
- **Synthetic IMU generation:** sample SMPL pose sequences from AMASS → attach virtual IMUs at standard rehab
  sites (pelvis/lower-back, thighs, shanks, feet, wrists, head/earbud) → differentiate global orientation &
  position to get gyro & accel → add **realistic degradations** (Gaussian + axis bias, gyro drift, gravity
  leakage, calibration/orientation jitter, dropout, resampling to 25–100 Hz). Joint angles come for free from
  SMPL.
- **Supervised fine-tune / eval:** TotalCapture, DIP-IMU (pose/angles); REALDISP (cross-position quality);
  Daphnet FoG (gait); HuGaDB, MHEALTH, DSADS, USC-HAD (gait/postural); imu-bbs (balance); MobiAct/FallTL/HHAR
  (robustness / cross-device). See `01_datasets.md` for roles.

### 5.2 Model
- **Backbone:** a compact **Transformer / patch-based time-series encoder** (think LIMU-BERT / UniMTS scale,
  not GPT scale) over windowed multi-channel IMU; channel- and placement-aware embeddings so the same model
  handles variable sensor sets.
- **Pretraining objectives:**
  - *Masked IMU modeling* (reconstruct masked patches — LIMU-BERT / MAE style).
  - *Contrastive* (RelCon / SimCLR-for-IMU style) with augmentations as positive pairs (jitter, rotation,
    time-warp, sensor-dropout) — directly encourages position/device invariance.
  - *(Optional) cross-modal* alignment to text or video labels for zero-shot heads (UniMTS / PRIMUS style).
- **Downstream heads (light, fine-tuned):**
  - (a) **Joint-angle / 3D-pose regression** (per-joint angle + optional SMPL pose) — metric: MPJAE / MPJPE.
  - (b) **Movement-quality / compensation** classification + rep segmentation/counting.
  - (c) **Balance / fall-risk**: regress TUG time / BBS sub-scores; detect freezing-of-gait.

### 5.3 Why this is "hard ML training" (and still GPU-feasible)
- Pretraining over **millions of windows** (real + synthetic) with masked + contrastive losses.
- A **physics simulator** in the data loop (AMASS→IMU) with sim-to-real domain adaptation.
- **Multi-task** heads + **domain-generalization** evaluation (leave-subject/position/device/dataset-out).
- *Scoping for a personal/cloud GPU:* small/medium transformer (≈5–30M params), mixed precision, gradient
  accumulation, curriculum (pretrain on a subset, scale up), and the option to **warm-start from released
  checkpoints** (LIMU-BERT, OxWearables SSL, UniMTS) instead of training from zero if time/compute is tight.

## 6. Evaluation protocol

- **Generalization axes (leave-X-out):** person, sensor position, device/sampling-rate, dataset.
- **Label-efficiency curves:** performance vs % of labeled fine-tuning data (1%, 10%, 100%).
- **Sim-to-real:** train-on-synthetic → test-on-real gap, with/without degradation augmentations.
- **Sensor-count ablation:** 1 vs 2 vs 3 vs 6 IMUs.
- **Metrics:** joint angle MAE / MPJAE (deg), MPJPE (mm) for pose; F1/macro-F1 for quality & FoG; MAE/ICC vs
  clinical TUG/BBS; calibration for risk outputs.
- **Baselines:** from-scratch CNN/CNN-LSTM, classical features + RF/SVM, and SSL baselines (LIMU-BERT, CPC,
  UniMTS) re-run on the same splits.

## 7. Risks & mitigations
- **Sim-to-real gap too large** → invest in degradation modeling + small real-data fine-tune; report honestly.
- **No single dataset has all rehab labels** → treat as a *benchmark suite*, not one dataset; map each task to
  its best-fit dataset (see `01_datasets.md`).
- **Compute limits** → warm-start from public checkpoints; shrink model; subsample pretraining corpus.
- **Clinical validity claims** → frame as *surrogate* estimation + agreement (ICC), not diagnosis; keep
  regulatory claims modest in the thesis, document a path (SaMD) in the product chapter.
- **Patient data ethics** → use only public/consented datasets; if collecting in-house, get IRB/ethics
  approval first.

## 8. Timeline (indicative, multi-month)

| Phase | Months | Output |
|------|--------|--------|
| 0. Setup & lit review | 1 | Reading list done (`02_reading_list.md`), env + data access, reproduce one SSL baseline (e.g. LIMU-BERT) |
| 1. Data + synthetic-IMU pipeline | 1–2 | AMASS→IMU simulator, real-data loaders, unified windowing, degradation augmentations |
| 2. Pretraining | 2 | Trained Mova encoder; ablate masked vs contrastive vs both |
| 3. Joint-angle head (RQ1–2) | 1–2 | Pose/angle results on TotalCapture/DIP-IMU + sim-to-real study |
| 4. Quality + balance heads (RQ4) | 1–2 | REALDISP / Daphnet-FoG / balance results |
| 5. Generalization benchmark (RQ3) | 1 | Cross-person/position/device/dataset tables vs baselines |
| 6. Product chapter + write-up | 1–2 | Mova MVP design, GTM, thesis draft, paper submission |

## 9. Success criteria
- SSL pretraining beats from-scratch supervised on ≥3 rehab tasks, *especially* at ≤10% labels.
- Joint-angle MAE competitive with sparse-IMU pose literature using **≤3** sensors.
- Measurable, reported generalization gains on ≥2 of the four leave-X-out axes.
- A coherent, defensible Mova product story grounded in the technical results.
