# Mova — Generalizable Motion Intelligence for Rehabilitation

**Mova** is a thesis project + startup concept: a **self-supervised motion foundation model** that turns
**1–3 low-cost IMUs** (phone, earbud, wrist/ankle band) into clinical-grade measurements for **home
rehabilitation** — **joint angles / range-of-motion, movement quality, and balance / fall-risk** — and that
**generalizes across patients, sensor placements, and devices**.

> One sentence: *Pretrain once on large unlabeled + physics-synthesized motion data; fine-tune tiny clinical
> heads; measure rehab outcomes from cheap wearables at home, without a camera.*

## Why it matters
- **Clinical:** Physiotherapy outcomes (ROM, compensation, balance) are still measured by eye or with $50k
  optical mocap. Wearable IMUs can do it objectively and continuously — *if* the model generalizes to real
  patients. That generalization gap is the unsolved problem.
- **Market:** Tele-rehab / digital MSK is **$5.4B (2024) → ~$15B (2032)**. **Sword Health** ($4B valuation)
  acquired **Kaia Health** for **$285M (Jan 2026)**. Incumbents use cameras or proprietary suits; Mova's wedge
  is **camera-free, consumer-grade IMUs, body-agnostic** → cheaper, private, works anywhere (incl. rural
  Central Asia).

## The hard-ML core
1. **Self-supervised pretraining** of an IMU encoder (masked reconstruction + contrastive) on:
   - **Real** large-scale free-living IMU (CAPTURE-24, aggregated HAR sets).
   - **Synthetic IMU** simulated from **AMASS** mocap (virtual sensors on the SMPL mesh) → unlimited motion
     with *exact* joint-angle ground truth. This is the engine for clinical-grade regression.
2. **Downstream clinical heads:** joint-angle/3D-pose regression, movement-quality/compensation scoring,
   balance/fall-risk (TUG/BBS-style), freezing-of-gait detection.
3. **Generalization study** (the thesis spine): cross-person, cross-position, cross-device, cross-dataset.

## Repository map
- [`docs/00_thesis_proposal.md`](docs/00_thesis_proposal.md) — full research plan: problem, RQs, method,
  evaluation protocol, compute plan, risks, month-by-month timeline.
- [`docs/01_datasets.md`](docs/01_datasets.md) — curated datasets with links, roles, and how each is used.
- [`docs/02_reading_list.md`](docs/02_reading_list.md) — the papers to read, grouped and prioritized, with
  *why each matters*.

## Sources of truth
- Awesome-IMU-Sensing list: https://github.com/rh20624/Awesome-IMU-Sensing
- Companion survey — *Towards Generalizable Human Activity Recognition*: https://arxiv.org/abs/2508.12213
