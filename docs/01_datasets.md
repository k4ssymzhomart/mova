# Mova — Datasets

Datasets are grouped by the **role** they play in the thesis. Two buckets matter most for a *rehab + joint
angle + balance* project that the activity-recognition–focused Awesome-IMU list under-covers:
**(A) mocap-paired IMU pose datasets** and **(B) the AMASS synthetic-IMU source**. The rest come straight from
the Awesome-IMU-Sensing README.

Legend: ⭐ = cornerstone (use first) · 🟡 = important · ⚪ = optional/robustness.

---

## A. Joint-angle / 3D-pose (mocap-paired) — the rehab core (NOT in the HAR list)

| Dataset | Role | Notes | Link |
|--------|------|-------|------|
| ⭐ **AMASS** | **Synthetic-IMU source + pretraining** | 40+ hrs, 300+ subjects of optical mocap unified on SMPL. Place *virtual* IMUs on the mesh → unlimited motion with exact joint angles. The engine for clinical-grade regression. | https://amass.is.tue.mpg.de/ |
| ⭐ **TotalCapture** | Real IMU + mocap eval | 13 IMUs + Vicon, 5 subjects, ~50 min. Standard sim-to-real / pose benchmark. | https://cvssp.org/data/totalcapture/ |
| ⭐ **DIP-IMU** | Real IMU + SMPL eval | 17 Xsens IMUs, 10 subjects, ~92 min / 330k frames. The canonical sparse-IMU pose benchmark. | https://dip.is.tue.mpg.de/ |
| 🟡 **SMPL** (body model) | Required for AMASS/DIP | Skinned body model (24 joints) used to render pose & synthesize IMU. | https://smpl.is.tue.mpg.de/ |

> Access note: AMASS / DIP / SMPL require a free academic registration + license acceptance. Start this on
> day 1 — approval can take a few days.

## B. Pretraining (large, unlabeled / self-supervised)

| Dataset | Role | Notes | Link |
|--------|------|-------|------|
| ⭐ **CAPTURE-24** | Real free-living pretraining | 151 subjects, ~3,883 hrs wrist accel with camera-derived labels. Big & real. | https://www.nature.com/articles/s41597-024-03960-3 |
| 🟡 **WHAR** (lib) | Unified multi-dataset loader | 10+ datasets in one framework — fast SSL corpus assembly. | https://github.com/teco-kit/whar-datasets |
| 🟡 **DAGHAR** (lib) | Cross-dataset eval harness | 5 standardized collections for cross-dataset transfer. | https://doi.org/10.5281/zenodo.11992126 |
| ⚪ **BenchHAR** (lib) | Benchmark harness | 14 datasets, standardized benchmarking. | https://github.com/saiketa/HAR-Bench |

## C. Movement quality & cross-position generalization

| Dataset | Role | Notes | Link |
|--------|------|-------|------|
| ⭐ **REALDISP** | **Cross-position** showcase | 17 subjects, 33 activities, *ideal vs self-placed vs displaced* sensors — perfect to prove placement invariance. | https://archive.ics.uci.edu/dataset/305/realdisp+activity+recognition+dataset |
| 🟡 **LARa** | Mocap + acc (ergonomics) | Optical mocap + accel; movement/ergonomics labels. | https://zenodo.org/records/8189341 |
| 🟡 **RecGym** | Exercise + rep structure | Gym exercises with acc/gyro + body-capacitance; good for rep counting / quality. | https://zhaxidele.github.io/RecGym/ |
| 🟡 **WEAR** | Exercise + video GT | Outdoor workouts, acc + video ground truth. | https://mariusbock.github.io/wear/ |
| ⚪ **DSADS** | Daily + sports postures | 8 subjects, 19 activities incl. sports. | https://archive.ics.uci.edu/dataset/256/daily+and+sports+activities |

## D. Gait, balance & clinical (the rehab outcomes)

| Dataset | Role | Notes | Link |
|--------|------|-------|------|
| ⭐ **Daphnet FoG** | Freezing-of-gait (Parkinson's) | 10 subjects, ankle/thigh/trunk accel labeled for FoG. Direct clinical task. | https://archive.ics.uci.edu/dataset/245/daphnet+freezing+of+gait |
| 🟡 **HuGaDB** | Gait segmentation + EMG | Acc/gyro per-leg-segment + EMG; gait phases. | https://github.com/romanchereshnev/HuGaDB |
| 🟡 **imu-bbs** | Berg Balance Scale + IMU | Small but directly clinical: postural balance in elderly scored with BBS. | https://github.com/ornwipa/imu-bbs |
| 🟡 **MHEALTH** | Multimodal + physiology | Acc/gyro/mag + ECG, rehab-style exercises. | https://archive.ics.uci.edu/dataset/319/mhealth+dataset |
| ⚪ **USC-HAD** | Postural/daily | 14 subjects, 12 activities incl. transitions. | https://sipi.usc.edu/had/ |
| ⚪ **PAMAP2** | Multimodal baseline | Acc/gyro/mag + HR, classic benchmark. | https://archive.ics.uci.edu/dataset/231/pamap2+physical+activity+monitoring |

## E. Robustness / cross-device / falls (held-out stress tests)

| Dataset | Role | Notes | Link |
|--------|------|-------|------|
| ⭐ **HHAR** | **Cross-device** showcase | Same activities across many phone/watch models — the canonical device-heterogeneity test. | https://archive.ics.uci.edu/dataset/344/heterogeneity+activity+recognition |
| 🟡 **FallTL** | Falls (2025) | 45 subjects, 46 activities incl. falls, 28 hrs. | https://zenodo.org/records/17552449 |
| ⚪ **MobiAct** | Falls + daily | 57 subjects, falls + ADLs. | https://bmi.hmu.gr/the-mobifall-and-mobiact-datasets-2/ |
| ⚪ **UMAFall** | Falls | 17 subjects, falls + ADLs. | https://figshare.com/articles/dataset/UMA_ADL_FALL_Dataset_zip/4214283 |

---

## Recommended starting subset (don't boil the ocean)
1. **AMASS + SMPL** → synthetic-IMU pipeline (the differentiator). ⭐
2. **TotalCapture + DIP-IMU** → real joint-angle eval / sim-to-real. ⭐
3. **CAPTURE-24** → real SSL pretraining. ⭐
4. **REALDISP** → cross-position generalization story. ⭐
5. **Daphnet FoG** (+ **imu-bbs**) → a concrete clinical rehab task (gait/balance). ⭐
6. **HHAR** → cross-device stress test. ⭐

Everything else is for breadth/robustness once the core loop works.

## Full Awesome-IMU index (every dataset + link)
Master list maintained upstream: https://github.com/rh20624/Awesome-IMU-Sensing
(IMU-only: Feng'26, CAPTURE-24, TNDA-HAR, KU-HAR, HARSense, HAR70+, WISDM, MotionSense, SHL, UniMiB-SHAR,
UMAFall, MobiAct, Shoaib, HHAR, HAPT, REALDISP, WHARF, DSADS, UCI-HAR, USC-HAD, Daphnet-FoG, Skoda · Multimodal:
HARMES, PAAWS, NFI_FARED, OctoNet, DCM, RecGym, WEAR, LARa, iSPL, HARTH, w-HAR, RealLifeHAR, MMAct, HuGaDB,
RealWorld, ExtraSensory, UTD-MHAD, MHEALTH, Berkeley-MHAD, PAMAP2, Opportunity).
