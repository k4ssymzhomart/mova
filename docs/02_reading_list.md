# Mova — Reading List

Grouped by theme, in suggested reading order. Each entry: **why it matters for Mova**. Links from the
Awesome-IMU list, arXiv, or publisher pages where confident; otherwise search the title.

## 🚀 Start here (read these 8 first)
1. **Towards Generalizable Human Activity Recognition: A Survey** (Cai et al., 2025) — the map of the whole
   problem; defines cross-person/device/position/dataset settings you'll evaluate. https://arxiv.org/abs/2508.12213
2. **LIMU-BERT** (Xu et al., SenSys 2021) — masked self-supervised pretraining on IMU; your pretraining
   starting point & baseline. https://github.com/dapowan/LIMU-BERT-Public
3. **Deep Inertial Poser (DIP)** (Huang et al., SIGGRAPH Asia 2018) — learn 3D pose from *sparse* IMUs; intro
   to the DIP-IMU benchmark. https://arxiv.org/abs/1810.04703
4. **TransPose** (Yi et al., SIGGRAPH 2021) — 6-IMU real-time pose; established the **AMASS→synthetic-IMU**
   training trick you'll reuse. https://arxiv.org/abs/2105.04605
5. **AMASS** (Mahmood et al., ICCV 2019) — the mocap corpus you synthesize IMU from. https://arxiv.org/abs/1904.03278
6. **Self-supervised HAR using 700,000 person-days** (Yuan et al., npj Digital Medicine 2024) — proof SSL at
   scale transfers; released checkpoints (OxWearables). https://github.com/OxWearables/ssl-wearables
7. **UniMTS: Unified Pre-training for Motion Time Series** (Zhang et al., NeurIPS 2024) — unified, placement-/
   orientation-robust pretraining; strong baseline + design ideas. https://github.com/xiyuanzh/UniMTS
8. **Berg Balance Scale scoring via attention DL + wearable IMU** (2024) — the clinical balance-estimation
   task, end-to-end. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12025094/

---

## 1. Framing & generalization (the thesis spine)
- *Towards Generalizable HAR: A Survey* (2025) — arXiv:2508.12213.
- **XHAR: Deep Domain Adaptation for HAR** (Zhou et al., SECON 2020) — cross-device adaptation.
- **CrossHAR: Generalizing Cross-dataset HAR via Hierarchical SSL** (2024) — cross-dataset transfer.
- **A Systematic Study of Unsupervised Domain Adaptation for Robust HAR** (Chang et al., IMWUT 2020).
- **ContrastSense: Domain-invariant Contrastive Learning** — invariance to person/device.

## 2. Self-supervised learning for IMU (the pretraining method)
- **LIMU-BERT** (SenSys 2021) — masked reconstruction. ⭐
- **Contrastive Predictive Coding for HAR** (Haresamudram et al., IMWUT 2021).
- **Assessing the State of SSL HAR with Wearables** (Haresamudram et al., IMWUT 2022) — what actually works.
- **What Makes Good Contrastive Learning on Small-Scale Wearable Tasks?** (Qian et al., KDD 2022) — augmentation
  choices (directly relevant to position/device invariance).
- **RelCon: Relative Contrastive Learning for a Motion Foundation Model** (Xu et al., ICLR 2025).
- **SelfHAR** / **ColloSSL** — self-training & multi-device collaborative SSL.

## 3. Foundation models for motion (architecture & scale)
- **UniMTS** (NeurIPS 2024) ⭐ · **Scaling Wearable Foundation Models** (Narayanswamy et al., ICLR 2025,
  arXiv:2410.13638) · **PRIMUS** (Das et al., 2024) — multimodal+SSL IMU pretraining ·
  **MASTER** (IMWUT 2025) · **Babel** (SenSys 2025) · **SensorLM** (NeurIPS 2025).

## 4. IMU → 3D pose / joint angles (the rehab measurement core) ⭐
- **Deep Inertial Poser** (2018) · **TransPose** (2021) · **Physical Inertial Poser (PIP)** (Yi et al.,
  CVPR 2022) — physics-constrained, improves plausibility (great for clinical realism).
- **TotalCapture** (Trumble et al., BMVC 2017) — dataset + fusion baseline. https://cvssp.org/data/totalcapture/
- **MobilePoser** (UIST 2024) — full-body pose from *consumer* phone/earbud IMUs (your product config).
  https://arxiv.org/abs/2504.12492
- **IMUPoser** (CHI 2023) — pose from everyday devices people already own.
- **Learning-based lower-limb joint kinematics from open-source IMU data** (Sci Rep 2025).
  https://www.nature.com/articles/s41598-025-89716-4
- **Lower-body kinematics from wearables for walking & running: a DL approach** (J. Biomech, 2020).
- **Upper-Limb Joint Angle Estimation with a Reduced Number of IMUs + RNN** (Electronics 2025).
  https://www.mdpi.com/2079-9292/14/15/3039

## 5. Clinical rehab, gait & balance (the application & validation)
- **BBS scoring via attention DL + IMU** (2024). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12025094/
- **Augmenting gait & balance outcomes with a single inertial sensor** (TUG/BBS/10mWT validation, 2019).
  https://pmc.ncbi.nlm.nih.gov/articles/PMC6832985/
- **Evaluation of standing balance using wearable IMUs: a machine-learning approach** (Expert Syst. Appl. 2020).
- **PrimSeq: DL pipeline to quantify stroke rehab training** (2021). https://arxiv.org/abs/2112.11330
- **Daphnet Freezing-of-Gait** detection literature (Parkinson's) — task + dataset.

## 6. Data augmentation & synthetic data (sim-to-real engine)
- **AutoAugHAR** (IMWUT 2024) — automated augmentation search.
- **A Diffusion Model for Inertial Time-Series Generation on Scarce Data** (Sci Rep 2025) — alternative
  synthetic-data route to compare against AMASS-physics synthesis.
- **Learning IMU Bias with Diffusion** (2025) — realistic bias/drift modeling for sim-to-real.

## 7. Startup / market context (for the product chapter)
- Telerehabilitation market sizing (~$5.4B'24 → $15.4B'32). https://www.mordorintelligence.com/industry-reports/telerehabilitation-market
- **Sword Health acquires Kaia Health ($285M, Jan 2026)** — comparable & thesis-of-business.
  https://www.mobihealthnews.com/news/sword-health-acquires-kaia-health-285m
- Digital MSK care market overview (Hinge/Sword/Kaia/Omada). https://www.coherentmarketinsights.com/industry-reports/digital-musculoskeletal-msk-care-market

---
**Tip:** the Awesome-IMU list (https://github.com/rh20624/Awesome-IMU-Sensing) is the live index — check it for
the newest entries each month; the field is moving fast (foundation models 2024–2026).
