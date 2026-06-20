# Mova — Research Library (evidence base for the Research page)

Curated, **cited** evidence behind the product. Summaries are our own one-liners; each entry should link to
its arXiv/DOI/publisher page on the website. **Do not host copyrighted PDFs** — link out, store BibTeX +
metadata only. Master index of IMU papers: the [Awesome-IMU-Sensing](https://github.com/rh20624/Awesome-IMU-Sensing)
list and its survey *Towards Generalizable HAR* (arXiv:2508.12213).

---

## A. Why the approach works — clinical evidence (the page that convinces clinicians/investors)

**Markerless pose is clinically usable but imperfect → fuse with IMU:**
- Accuracy/Reliability of Markerless Pose for Upper-Limb Kinematics across ROM tasks — Appl. Sci. 2026. https://www.mdpi.com/2076-3417/16/3/1202
- Markerless joint-angle estimation with MediaPipe for joint-moment calculation — Multimedia Tools & Apps 2026. https://link.springer.com/article/10.1007/s11042-026-21256-z
- Tracking upper-limb reaching after stroke with MediaPipe (proof-of-principle) — J. NeuroEng. Rehab. 2025. https://link.springer.com/article/10.1186/s12984-025-01808-4
- Validation of single-camera BlazePose for knee-angle measurement — JMIR preprint #102399. https://preprints.jmir.org/preprint/102399
- ML pose-estimation models in movement/posture analysis (review) — ScienceDirect 2024. https://www.sciencedirect.com/science/article/pii/S2405844024160082
- *Takeaway:* correlation ≈0.91 (upper-limb) / ≈0.80 (lower-limb) vs. lab mocap, but occlusion + extreme
  flexion drive errors up to ~17° → **IMU fusion is justified, not optional.**

**Gamified / VR rehab improves outcomes and adherence:**
- VR to improve motor function in CP/Parkinson's/stroke — systematic review of RCTs, 2021. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8343554/
- VR-supported exercise for upper-extremity motor rehab after stroke — systematic review + meta-analysis of RCTs, 2022. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9253973/
- Home-based non-immersive VR after stroke discharge — feasibility RCT, 2025. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11992496/
- Immersive VR for stroke rehab — linking clinical + digital motor-recovery measures (pilot), 2025. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12837790/
- *Takeaway:* gamified VR improves UE motor function + ROM and raises **adherence/motivation** — the main
  failure point of home rehab.

---

## B. Motion foundation models & self-supervised learning (our model lineage)
- **LIMU-BERT** — Xu et al., SenSys 2021. Masked-prediction pretraining on unlabeled IMU. *Our encoder's basis.*
- **UniMTS** — Zhang et al., NeurIPS 2024. Unified motion-time-series pretraining; cross-device/activity robust.
- **RelCon** — Xu et al., ICLR 2025. Relative contrastive learning for a motion foundation model.
- **PRIMUS** — Das et al., NeurIPS 2024. Multimodal (video) + self-supervised IMU pretraining.
- **Scaling Wearable Foundation Models** — Narayanswamy et al., ICLR 2025; and **700k person-days SSL** — Yuan et al., npj Digital Medicine 2024.
- **MASTER** — Zhu et al., IMWUT 2025. Multi-modal HAR foundation model.
- **Babel** — Dai et al., SenSys 2025. Expandable modality alignment (add sensors without retraining).
- **SensorLM** — Zhang et al., NeurIPS 2025. Sensor→language embeddings (LLM reasoning over signals).
- **RobustHAR** — Liu et al., IJCAI 2025; **LSM-2 (incomplete wearable data)** — Xu et al., 2025; **MoPFormer** — Zhang et al., NeurIPS 2025 (interpretable motion primitives).

## C. Cross-modal IMU ↔ video (the data-flywheel: bootstrap, fuse, synthesize)
- **Vision2Sensor** — Radu et al., IMWUT 2019. Transfer video activity recognition to IMU.
- **IMUTube** — Kwon et al., IMWUT 2020. Synthesize on-body accelerometry from video. *Core to our flywheel.*
- **Virtual IMU from simulation** — Kwon et al., IMWUT 2021; **text→virtual-IMU** — Leng et al., ISWC 2023.
- **Synthetic smartwatch IMU from ASL video** — Santhalingam et al., IMWUT 2023. *Hand-rehab relevant.*
- **Zero-shot IMU via video embeddings** — Tong et al., IMWUT 2021; **COCOA** — Deldari et al., IMWUT 2022; **CroSSL** — Deldari et al., WSDM 2024.
- **IMU2CLIP** — Moon et al., EMNLP 2023; **FOCAL** — Liu et al., NeurIPS 2023; **TS2ACT** — Xia et al., IMWUT 2024.
- **COMODO** (video→IMU distillation) — Chen et al., 2025; **Wonderwall** (virtual→real IMU FM) — Miao et al., IMWUT 2026; **Vsens** (XR-collected virtual IMU) — Liang et al., IMWUT 2026. *Directly support VR-session→training data.*
- **MESEN** — Xu et al., SenSys 2023. Train multimodal, deploy single-IMU (cost-effective clinics).

## D. Rehabilitation / clinical IMU applications
- Real-time IMU motion-capture for **gait rehabilitation** — Kong et al., ROBIO 2013.
- **UbiPhysio** — Wang et al., IMWUT 2024. Activity understanding + natural-language rehab coaching.
- **PDLens** (Parkinson's medication efficacy from daily activity) — Zhang et al., MobiCom 2020.
- Protective/compensatory behavior detection — Wang et al., IMWUT 2021.
- Near-fall detection (single IMU) — Choi et al., TNSRE 2022; large-scale fall dataset + dual-branch net — Cai et al., TNSRE 2025.
- **Personalized ML wearable-robot control improves impaired arm function** — Arnold et al., Nature Comms 2025.
- Mobile-phone digital biomarkers for Parkinson's — He et al., TMC 2025.

## E. Datasets & benchmark libraries (Datasets + Benchmark pages)
- **In use:** HHAR (cross-device), Daphnet-FoG (freezing of gait), REALDISP (cross-position) → 672k canonical windows.
- **Roadmap:** CAPTURE-24 (free-living, large), AMASS (mocap → synthetic IMU), TotalCapture/DIP-IMU (pose).
- **Curation/benchmark libraries:** **WHAR** (unified multi-dataset handling), **DAGHAR** (cross-dataset eval), **BenchHAR** ("Benchmarking SSL for generalizable HAR", 14 datasets). *Basis of our Benchmark leaderboard.*

## F. Data augmentation & synthetic generation (data-scarcity strategy)
- **AutoAugHAR** — Zhou et al., IMWUT 2024 (auto augmentation search).
- **HMGAN** — Chen et al., IMWUT 2023 (GAN IMU synthesis); **Diffusion for inertial time series on scarce data** — Oppel et al., Sci. Reports 2025; **DI2SDiff++** — Zhang et al., TMC 2025; **Learning IMU bias with diffusion** — Zhou et al., 2025.
- **GEGLU-Transformer IMU→EMG (few-shot)** — Mihailovic et al., 2026 (bridge to EMG for incomplete setups).

---

### Handling note (legal)
For the website Research page: render title + authors + venue/year + our 1-line summary + an outbound link to
arXiv/DOI. Keep a `references.bib` of BibTeX entries in the repo. **Never** mirror publisher PDFs; link only.
This keeps the credibility surface rich and compliant.
