# Phase 3 — Metrics Report (honest)

> Doctrine (Master Doc Part 9): report real numbers **and** failure modes; evaluation design
> outranks any single number; never present a misleading score as a win. Everything here is from
> live runs on real data — `reports/fog_loso_{ssl,scratch}.json`, `reports/har.json`,
> `reports/movement_quality.json`, `benchmark/leaderboard.json`. Single Apple-Silicon GPU (MPS).

## Headline
**FoG, leave-one-subject-out CV over 8 freeze-positive Daphnet subjects, SSL-pretrained encoder:
AUROC 0.723 ± 0.051** — beats the honest **0.551** baseline by **+0.172**. From-scratch ablation is
0.685 ± 0.064, so SSL pretraining contributes **+0.038** AUROC on top.

But the honest caveat up front: at the clinically-conservative tuned operating point
(specificity ≥ 0.85), **sensitivity is only 0.31 ± 0.19** — the detector still misses ~69% of freeze
windows at that threshold, and the operating point does not calibrate stably across subjects. The
*ranking* is a clear win; a *deployable* freeze detector this is not yet.

---

## 1. FoG — the headline task

### Protocol
- **LOSO-CV** over the 8 freeze-positive subjects (S01–S03, S05–S09). S04 and S10 have **zero**
  freeze windows → never a test fold; they remain in training as extra negatives.
- Per fold: **test** = held-out subject · **val** = one other positive subject (threshold tuning
  only) · **train** = the remaining 8 subjects.
- **focal loss** (γ = 2) + class-balanced sampler; decision **threshold tuned on the val subject**
  to hit sensitivity @ specificity ≥ 0.85 — never tuned on test.
- **Leakage control:** the encoder is SSL-pretrained on HHAR + REALDISP only; **no Daphnet subject
  and no HAR test window ever enters pretraining**, so the FoG (and HAR) evaluations are clean.

### Results — mean ± std across 8 folds (tuned operating point)
| metric | SSL pretrain | from-scratch (ablation) |
|---|---|---|
| **AUROC** | **0.723 ± 0.051** | 0.685 ± 0.064 |
| AUPRC | 0.259 ± 0.131 | 0.212 ± 0.097 |
| sensitivity @ spec≥0.85 | 0.312 ± 0.193 | 0.275 ± 0.143 |
| specificity | 0.859 ± 0.109 | 0.851 ± 0.065 |
| baseline AUROC | 0.551 | — |

### Per-subject (SSL, tuned)
| subj | test windows | freeze % | AUROC | AUPRC | sens | spec | scratch AUROC |
|---|---|---|---|---|---|---|---|
| S01 | 5709 | 4.7% | 0.750 | 0.133 | 0.370 | 0.905 | 0.675 |
| S02 | 4251 | 12.8% | 0.715 | 0.204 | 0.344 | 0.806 | 0.712 |
| S03 | 6042 | 14.1% | 0.780 | 0.339 | 0.418 | 0.842 | 0.748 |
| S05 | 6288 | 22.9% | 0.769 | 0.438 | 0.159 | 0.959 | 0.708 |
| S06 | 5985 | 6.4% | 0.685 | 0.094 | 0.076 | 0.936 | 0.658 |
| S07 | 4836 | 4.4% | 0.705 | 0.104 | 0.634 | 0.619 | 0.687 |
| S08 | 2322 | 26.2% | 0.616 | 0.388 | 0.034 | 0.983 | 0.538 |
| S09 | 5235 | 15.1% | 0.762 | 0.371 | 0.460 | 0.823 | 0.755 |
| **mean** | | | **0.723** | 0.259 | 0.312 | 0.859 | 0.685 |

### Same models at threshold 0.5 (no tuning)
sensitivity **0.889 ± 0.061**, specificity **0.426 ± 0.163** — the decision flips to high recall /
poor specificity. There is no free lunch: the score distributions for freeze vs non-freeze overlap
heavily, so *any* single threshold trades one off hard against the other.

---

## 2. Failure analysis (brutally honest)

1. **Operating-point sensitivity is poor (0.31).** AUROC 0.72 means the model *ranks* freeze vs
   non-freeze windows decently, but turning that ranking into a usable decision is where it breaks:
   at specificity ≥ 0.85 it catches only ~31% of freeze windows. This is the single most important
   honest fact — the headline AUROC oversells clinical readiness.
2. **The threshold does not transfer across subjects.** We tune on one val subject; the test
   subject's score distribution shifts, so the chosen threshold lands in the wrong place — S08 tuned
   sensitivity 0.034 (threshold too high for that subject), S07 0.634 (it happened to fit). The
   0.19 std on sensitivity is this instability. Per-subject or population-level calibration is the
   obvious next step.
3. **Daphnet is accelerometer-only.** The gyro half of every 6-channel window is **zero-filled** —
   half the input modality is dead for this task. That is a hard ceiling; the path up is real gyro
   (DIP-style) and the Bachlin Freeze-Index as an engineered channel / baseline-to-beat.
4. **Per-subject variance is large and a single subject is not an evaluation.** AUROC ranges 0.616
   (S08) → 0.780 (S03). S08 — 26% freeze, the shortest recording — is near chance; from scratch it
   is **0.538, *below* the baseline**, and SSL rescues it to 0.616. This is exactly why we report
   LOSO mean ± std rather than a lucky single split (the original 0.55 was one held-out subject).
5. **Rare positives, small model, bounded compute.** AUPRC 0.26 reflects ~9.5% prevalence; the
   encoder is ~0.6M params, SSL ran 1500 steps and FoG fine-tune 5 epochs on a single MPS GPU —
   not run to convergence. These are honest scope limits, not tuned-away.

### Where SSL actually helps
SSL's gain concentrates on the **hardest** subjects: S08 **+0.078** (0.538 → 0.616, below-chance →
above), S01 **+0.075**; roughly neutral on already-easy S02/S09. That is the thesis claim in
miniature — self-supervised representations transfer best where labeled signal is weakest — though
the effect here is modest (+0.038 mean) given the compute budget.

---

## 3. HAR + generalization

37-class activity recognition, subject-disjoint test, **3 epochs (under-trained — stated honestly)**.

- **macro-F1 overall = 0.405** (warm-started from SSL). The Master-Doc in-distribution target is
  ≥ 0.90 — **not met**: this is an under-trained, 37-class macro-F1 (which penalizes every class with
  thin/zero test support), not a converged HAR model. HAR is not the Phase-3 headline.
- **Cross-dataset:** HHAR 0.453 vs REALDISP 0.335 — REALDISP's 33 fine-grained fitness classes are
  much harder than HHAR's locomotion set.
- **Cross-position spread:** placement macro-F1 ranges **0.179 (r_calf) → 0.530**, a **0.351 drop**.
  Forearm placements (~0.445) are far easier than leg placements (~0.18–0.31) for this class mix —
  a real, quantified cross-position generalization gap.
- **Caveat:** placements/devices are *seen in training*; true leave-placement-out / leave-device-out
  is future work, not claimed here.

---

## 4. Movement quality (synthetic proxy — real data pending)

Clinician-scored rehab data (KIMORE/UI-PRMD) was **not obtained**, so this is an honest *proxy*: AMASS
gives a paired signal — wrist **virtual-IMU window** (input) and exact pose-derived **LDLJ smoothness**
(target).

- **Pearson r = 0.609** on a held-out actor (HDM05_tr, n = 470 windows), subject-disjoint, 4 actors.
- Below the 0.70 clinical-correlation target, but it proves the `encoder + RegressionHead` pipeline
  works and that **sparse IMU carries the smoothness signal**. Real cTS/PO clinician-score evaluation
  is gated on dataset access.

---

## 5. Fusion + virtual-IMU engine

`ComplementaryFilter` + `CrossModalFusion` (confidence-gated cross-attention: as CV confidence → 0 it
falls back to IMU-only) + `VirtualImuEngine` over the SMPL mock. **Unit-tested** (output shapes,
gating behaviour, synthesis determinism). No real paired CV+IMU data yet → architecture + synthetic
validation only; honest about that.

---

## 6. Deployment

ONNX export of the encoder + FoG/HAR heads (opset 17), **verified against PyTorch under onnxruntime
(max abs diff < 2e-4)**. Checkpoints + ONNX are gitignored binaries; the registry
(`data_manifests/model_registry.json`) and model cards (`data_manifests/model_cards/`) carry the
metadata and honest limitations.

---

## 7. Bottom line
- ✅ **Beat the 0.55 FoG baseline** — 0.723 ± 0.051 LOSO AUROC (+0.17), with the right protocol
  (subject-disjoint LOSO, leakage-free SSL, from-scratch ablation, val-tuned thresholds).
- ⚠️ **Not yet clinically usable** — operating-point sensitivity 0.31; blocked by the accel-only
  ceiling, per-subject threshold drift, a small/compute-bounded model, and window- (not event-) level
  scoring.
- The real deliverable is the **evaluation design + the honest gap**, not a deployable detector. Next
  levers, in order of expected payoff: real gyro / Freeze-Index channel → per-subject calibration →
  event-level smoothing → more SSL + encoder capacity.
