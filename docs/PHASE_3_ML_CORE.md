# Phase 3 — Motion-Intelligence ML Core

The headline phase: turn the Phase-2 data platform into trained models that **beat the honest
0.55-AUROC FoG baseline** the right way — self-supervised pretraining, leave-one-subject-out
cross-validation, imbalance-aware losses, threshold tuning — plus the heads, fusion, virtual-IMU
engine, ONNX export, and the credibility surfaces (registry, model cards, benchmark leaderboard).

> Numbers live in [`reports/PHASE_3_METRICS_REPORT.md`](../reports/PHASE_3_METRICS_REPORT.md) and the
> machine-readable [`benchmark/leaderboard.json`](../benchmark/leaderboard.json). This doc is the
> design + how-to.

## 1. Real data landscape (Phase 3 scope adjustment)
- **Obtained & ingested:** AMASS **HDM05** subset (215 `.npz`, actors bk/dg/mm/tr) and **DIP-IMU**
  (10 subjects). `scripts/data/ingest_real_data.py` moves them into `data/raw/{amass,dip_imu}`.
- **Dropped — TotalCapture:** access denied, **permanently out of scope**; every adapter, config,
  card, fixture, and test reference removed.
- **Mocked — SMPL:** the licensed body-model download was blocked, so `mova.synth.smpl.SmplSkeleton`
  ships a **mock skeleton** (published kinematic tree + fixed anthropometric rest offsets).
  Consequence: AMASS virtual-IMU **gyro is exact** (pose-only), **accel is approximate**
  (`make_model = amass_virtual_mock_smpl`). Drop a real SMPL `.pkl` at `data/raw/smpl/` and
  `SmplSkeleton.from_model_or_mock` upgrades every path automatically — nothing else changes.

## 2. Encoder
LIMU-BERT-style per-timestep Transformer (`mova.models.encoder`), hidden 128, 3 layers, with
placement + dataset **conditioning embeddings** for cross-position / cross-device robustness. The
same encoder is shared by SSL pretraining and every head (warm-start needs identical dims).

## 3. Self-supervised pretraining (`mova.train.pretrain`, `mova.ssl`)
- **Masked IMU modeling** — span-mask ~15% of timesteps (BERT 80/10/10 corruption), reconstruct with
  **smooth-L1** (robust to IMU spikes).
- **Contrastive NT-Xent** — two augmented views per window; augmentations (`mova.ssl.augment`):
  small SO(3) **rotation**, **time-warp**, **scaling**, **jitter**, **sensor-dropout** — exactly the
  cross-device / cross-position / noise nuisances we want invariance to.
- **Leakage control (critical):** pretrain only on **HHAR + REALDISP train** windows. No Daphnet
  subject (the FoG LOSO target) and no HAR test window ever enters pretraining, so *both* downstream
  evaluations stay strictly clean with a single pretrain.

## 4. FoG — the headline (`mova.train.fog_loso`)
- **LOSO-CV over the 8 freeze-positive Daphnet subjects** (S04, S10 have zero freezes → never a test
  fold; they stay in training as extra negatives). Each positive subject is the test fold once.
- Per fold: **test** = held-out subject; **val** = one other positive subject (threshold tuning
  only); **train** = the remaining 8.
- **Imbalance:** focal loss (γ=2) + class-balanced sampler.
- **Decision threshold tuned on the val subject** (sensitivity @ specificity ≥ 0.85), never on test.
- **Reported as mean ± std** across folds — AUROC, AUPRC, sensitivity@spec — plus the **SSL vs
  from-scratch ablation** so SSL's contribution is isolated.

## 5. HAR + generalization (`mova.train.har`)
Activity head on the subject-disjoint test split; macro-F1 overall and **broken down by dataset
(HHAR vs REALDISP) and placement** — the honest, available view of cross-device / cross-position
spread. A full leave-placement-out protocol is labelled future work.

## 6. Movement quality (`mova.train.quality`) — synthetic proxy
Real clinician-scored data (KIMORE/UI-PRMD) is **not yet obtained**. As a stand-in, AMASS provides a
*paired* signal: virtual-IMU window (input) + exact pose-derived **smoothness** / LDLJ (target). We
train `encoder + RegressionHead` and report Pearson r on held-out HDM05 actors. Honestly a proxy —
it proves the head + pipeline and that sparse IMU carries the smoothness signal.

## 7. Fusion + virtual-IMU engine (`mova.models.fusion`, `mova.synth.engine`)
- `ComplementaryFilter` (classical orientation fuser) + `CrossModalFusion` — confidence-gated
  cross-attention over IMU and pose embeddings; as CV confidence → 0 it falls back to IMU-only.
- `VirtualImuEngine` unifies both synthesis paths (AMASS SMPL pose; session keypoints) behind the
  same SMPL mock — it feeds the Phase-2 flywheel ETL gate.

## 8. Deployment + credibility surfaces
- **ONNX export** (`mova.export.onnx_export`): encoder + head → ONNX (opset 17), **verified against
  PyTorch under onnxruntime** (parity < 2e-4).
- **Model registry** (`data_manifests/model_registry.json`) + **model cards**
  (`data_manifests/model_cards/*.md`) — honest, generated from the registry.
- **Benchmark leaderboard** (`benchmark/leaderboard.json`) — the Phase-8 Benchmark page renders from
  this; nothing hand-typed.

## 9. Run it
```bash
pip install -e ".[ml]" onnx onnxruntime          # MPS/CUDA torch
# 1) SSL pretrain (leakage-free corpus)
python -m mova.train.pretrain --processed-dir data/processed --out checkpoints/ssl_encoder.ckpt
# 2) everything else from the SSL checkpoint
python scripts/train/run_phase3.py --processed-dir data/processed \
    --ssl-ckpt checkpoints/ssl_encoder.ckpt --amass-dir data/raw/amass
```
Individual stages: `mova.train.fog_loso`, `mova.train.har`, `mova.train.quality`,
`mova.export.onnx_export`, `mova.eval.benchmark`.

## 10. Honesty notes
- Compute is a **single Apple-Silicon GPU**; SSL is step-bounded, not run to convergence — the report
  states the exact budget and treats SSL as one ingredient, not magic.
- Daphnet is **accelerometer-only**: the gyro half of each window is zero-filled (a known ceiling).
- Eval **design** (subject-disjoint, LOSO mean±std, tuned-on-val thresholds, SSL/scratch ablation)
  outranks any single number. See the metrics report for per-subject variance and failure analysis.
