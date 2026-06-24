/**
 * Mova research library — the evidence base behind the product.
 * Sourced from docs/research_library.md. Per our handling rule we render
 * title + authors/venue/year + our own one-line summary + an outbound link.
 * We never host publisher PDFs — links only.
 */

const scholar = (q: string) =>
  `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`;

export type Paper = {
  title: string;
  meta: string; // authors · venue · year
  summary: string; // our own one-liner
  href: string;
};

export type ResearchCategory = {
  id: string;
  label: string;
  title: string;
  blurb: string;
  papers: Paper[];
};

export const RESEARCH_INTRO = {
  kicker: "Research",
  title: "The evidence base behind Mova",
  body: "Mova is built on the published science of inertial sensing, motion foundation models and movement rehabilitation. Every entry below links out to its source — we summarise in one line and never host the PDFs.",
  note: "Summaries are our own. Titles link to the publisher, arXiv or DOI.",
};

export const RESEARCH: ResearchCategory[] = [
  {
    id: "clinical",
    label: "Clinical evidence",
    title: "Why the approach works",
    blurb:
      "Markerless pose is clinically usable but imperfect — which is exactly why fusing it with IMU is justified — and gamified/VR rehab measurably lifts outcomes and adherence.",
    papers: [
      {
        title: "Accuracy & reliability of markerless pose for upper-limb kinematics across ROM tasks",
        meta: "Applied Sciences · 2026",
        summary: "Correlation ≈0.91 vs lab mocap for upper-limb angles — usable, but occlusion drives error.",
        href: "https://www.mdpi.com/2076-3417/16/3/1202",
      },
      {
        title: "Markerless joint-angle estimation with MediaPipe for joint-moment calculation",
        meta: "Multimedia Tools & Applications · 2026",
        summary: "Single-camera pose can feed joint-moment estimates, extending markerless analysis to kinetics.",
        href: "https://link.springer.com/article/10.1007/s11042-026-21256-z",
      },
      {
        title: "Tracking upper-limb reaching after stroke with MediaPipe",
        meta: "Journal of NeuroEngineering & Rehabilitation · 2025",
        summary: "Proof-of-principle that consumer pose tracking captures clinically meaningful reaching after stroke.",
        href: "https://link.springer.com/article/10.1186/s12984-025-01808-4",
      },
      {
        title: "Validation of single-camera BlazePose for knee-angle measurement",
        meta: "JMIR (preprint #102399)",
        summary: "BlazePose knee angles track reference within usable bounds for lower-limb screening.",
        href: "https://preprints.jmir.org/preprint/102399",
      },
      {
        title: "ML pose-estimation models in movement & posture analysis (review)",
        meta: "Heliyon / ScienceDirect · 2024",
        summary: "Survey of where markerless pose is reliable — and where extreme flexion pushes errors to ~17°.",
        href: "https://www.sciencedirect.com/science/article/pii/S2405844024160082",
      },
      {
        title: "VR to improve motor function in CP, Parkinson's & stroke",
        meta: "Systematic review of RCTs · 2021",
        summary: "Across conditions, VR rehab improves motor function versus conventional therapy alone.",
        href: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8343554/",
      },
      {
        title: "VR-supported exercise for upper-extremity motor rehab after stroke",
        meta: "Systematic review + meta-analysis of RCTs · 2022",
        summary: "Pooled RCTs show VR-supported training improves upper-extremity recovery and range of motion.",
        href: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9253973/",
      },
      {
        title: "Home-based non-immersive VR after stroke discharge",
        meta: "Feasibility RCT · 2025",
        summary: "Home VR is feasible post-discharge — addressing the adherence gap that sinks home rehab.",
        href: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11992496/",
      },
    ],
  },
  {
    id: "foundation-models",
    label: "Foundation models",
    title: "Motion foundation models & self-supervised learning",
    blurb:
      "Mova's encoder lineage: masked and contrastive pretraining on large unlabeled inertial data that generalises across devices and activities.",
    papers: [
      {
        title: "LIMU-BERT: masked-prediction pretraining on unlabeled IMU",
        meta: "Xu et al. · SenSys · 2021",
        summary: "The basis of our encoder — BERT-style masked pretraining for inertial signals.",
        href: scholar("LIMU-BERT unlabeled IMU SenSys 2021"),
      },
      {
        title: "UniMTS: unified motion time-series pretraining",
        meta: "Zhang et al. · NeurIPS · 2024",
        summary: "Cross-device, cross-activity robust pretraining for motion time series.",
        href: scholar("UniMTS unified motion time series pretraining NeurIPS 2024"),
      },
      {
        title: "RelCon: relative contrastive learning for a motion foundation model",
        meta: "Xu et al. · ICLR · 2025",
        summary: "Relative contrastive objective tailored to building a general motion foundation model.",
        href: scholar("RelCon relative contrastive motion foundation model ICLR 2025"),
      },
      {
        title: "PRIMUS: multimodal video + self-supervised IMU pretraining",
        meta: "Das et al. · NeurIPS · 2024",
        summary: "Pairs video with IMU for richer self-supervised representations.",
        href: scholar("PRIMUS multimodal self-supervised IMU pretraining"),
      },
      {
        title: "Scaling wearable foundation models",
        meta: "Narayanswamy et al. · ICLR · 2025",
        summary: "Shows the scaling behaviour of foundation models on wearable sensor data.",
        href: scholar("Scaling wearable foundation models ICLR 2025"),
      },
      {
        title: "Self-supervised learning on 700k person-days of wearable data",
        meta: "Yuan et al. · npj Digital Medicine · 2024",
        summary: "Large-scale SSL on real-world accelerometry — evidence the data scales.",
        href: scholar("self-supervised learning 700000 person days wearable npj digital medicine 2024"),
      },
      {
        title: "Babel: expandable modality alignment",
        meta: "Dai et al. · SenSys · 2025",
        summary: "Add new sensor modalities without retraining the whole model.",
        href: scholar("Babel expandable modality alignment SenSys 2025"),
      },
      {
        title: "SensorLM: sensor-to-language embeddings",
        meta: "Zhang et al. · NeurIPS · 2025",
        summary: "Bridges raw sensor signals to language so LLMs can reason over them.",
        href: scholar("SensorLM sensor language embeddings NeurIPS 2025"),
      },
    ],
  },
  {
    id: "cross-modal",
    label: "Cross-modal",
    title: "Cross-modal IMU ↔ video (the data flywheel)",
    blurb:
      "How we bootstrap, fuse and synthesize: transfer from video to IMU, generate virtual inertial data, and deploy single-sensor at the edge.",
    papers: [
      {
        title: "IMUTube: synthesizing on-body accelerometry from video",
        meta: "Kwon et al. · IMWUT · 2020",
        summary: "Core to our flywheel — turns ordinary video into training-grade virtual IMU.",
        href: scholar("IMUTube synthesizing accelerometry from video IMWUT 2020"),
      },
      {
        title: "Vision2Sensor: transferring video activity recognition to IMU",
        meta: "Radu et al. · IMWUT · 2019",
        summary: "Early demonstration of moving recognition knowledge from camera to sensor.",
        href: scholar("Vision2Sensor video activity recognition IMU IMWUT 2019"),
      },
      {
        title: "IMU2CLIP: aligning inertial signals with the CLIP space",
        meta: "Moon et al. · EMNLP · 2023",
        summary: "Aligns IMU with vision-language embeddings for zero-shot motion understanding.",
        href: scholar("IMU2CLIP EMNLP 2023"),
      },
      {
        title: "MESEN: train multimodal, deploy single-IMU",
        meta: "Xu et al. · SenSys · 2023",
        summary: "Exactly our deployment story — rich multimodal training, cheap single-sensor inference.",
        href: scholar("MESEN multimodal train single IMU deploy SenSys 2023"),
      },
      {
        title: "COMODO: video-to-IMU cross-modal distillation",
        meta: "Chen et al. · 2025",
        summary: "Distills knowledge from video teachers into IMU students.",
        href: scholar("COMODO video IMU distillation 2025"),
      },
    ],
  },
  {
    id: "rehab",
    label: "Rehab applications",
    title: "Rehabilitation & clinical IMU applications",
    blurb:
      "Inertial sensing already drives gait rehab, Parkinson's monitoring, fall detection and personalised wearable-robot control.",
    papers: [
      {
        title: "UbiPhysio: activity understanding + natural-language rehab coaching",
        meta: "Wang et al. · IMWUT · 2024",
        summary: "Couples movement understanding with language feedback — a model for at-home coaching.",
        href: scholar("UbiPhysio activity understanding rehabilitation IMWUT 2024"),
      },
      {
        title: "PDLens: Parkinson's medication efficacy from daily activity",
        meta: "Zhang et al. · MobiCom · 2020",
        summary: "Infers medication response from everyday movement — the longitudinal value we target.",
        href: scholar("PDLens Parkinson medication efficacy daily activity MobiCom 2020"),
      },
      {
        title: "Personalised ML wearable-robot control improves impaired-arm function",
        meta: "Arnold et al. · Nature Communications · 2025",
        summary: "Personalised models materially improve assisted movement outcomes.",
        href: scholar("personalized machine learning wearable robot impaired arm Nature Communications 2025"),
      },
      {
        title: "Near-fall detection from a single IMU",
        meta: "Choi et al. · IEEE TNSRE · 2022",
        summary: "Single-sensor near-fall detection — a safety signal for unsupervised home use.",
        href: scholar("near-fall detection single IMU TNSRE 2022"),
      },
      {
        title: "Mobile-phone digital biomarkers for Parkinson's",
        meta: "He et al. · IEEE TMC · 2025",
        summary: "Phone-only sensing yields usable Parkinson's biomarkers — no special hardware.",
        href: scholar("mobile phone digital biomarkers Parkinson IEEE TMC 2025"),
      },
    ],
  },
  {
    id: "datasets",
    label: "Datasets & benchmarks",
    title: "Datasets & benchmark libraries",
    blurb:
      "What we train and evaluate on — from the cohorts already in our pipeline to the cross-dataset benchmarks behind our leaderboard.",
    papers: [
      {
        title: "Daphnet — Freezing of Gait dataset",
        meta: "In use · Parkinsonian gait",
        summary: "The freezing-of-gait cohort behind Mova's flagship detection benchmark.",
        href: scholar("Daphnet freezing of gait dataset"),
      },
      {
        title: "HHAR — Heterogeneity human activity recognition",
        meta: "In use · cross-device",
        summary: "Cross-device cohort we use to stress-test generalisation across hardware.",
        href: scholar("HHAR heterogeneity activity recognition dataset"),
      },
      {
        title: "REALDISP — activity recognition with sensor displacement",
        meta: "In use · cross-position",
        summary: "Cross-position cohort for robustness to where the sensor actually sits.",
        href: scholar("REALDISP activity recognition sensor displacement dataset"),
      },
      {
        title: "CAPTURE-24 — free-living wearable dataset",
        meta: "Roadmap · large, in-the-wild",
        summary: "Large free-living accelerometry — the scale-up target for real-world training.",
        href: scholar("CAPTURE-24 free living accelerometer dataset"),
      },
      {
        title: "BenchHAR — benchmarking SSL for generalizable HAR",
        meta: "14 datasets",
        summary: "Multi-dataset benchmark that grounds our self-supervised leaderboard.",
        href: scholar("BenchHAR benchmarking self-supervised generalizable HAR"),
      },
    ],
  },
  {
    id: "augmentation",
    label: "Synthetic & augmentation",
    title: "Data augmentation & synthetic generation",
    blurb:
      "Our answer to data scarcity: automated augmentation and generative models that synthesize realistic inertial signals.",
    papers: [
      {
        title: "AutoAugHAR: automated augmentation search for HAR",
        meta: "Zhou et al. · IMWUT · 2024",
        summary: "Searches augmentation policies automatically instead of hand-tuning them.",
        href: scholar("AutoAugHAR automated augmentation human activity recognition IMWUT 2024"),
      },
      {
        title: "HMGAN: GAN-based IMU synthesis",
        meta: "Chen et al. · IMWUT · 2023",
        summary: "Generates synthetic inertial data to expand scarce training sets.",
        href: scholar("HMGAN GAN IMU synthesis IMWUT 2023"),
      },
      {
        title: "Diffusion for inertial time series on scarce data",
        meta: "Oppel et al. · Scientific Reports · 2025",
        summary: "Diffusion models produce realistic inertial signals when labelled data is thin.",
        href: scholar("diffusion inertial time series scarce data Scientific Reports 2025"),
      },
      {
        title: "GEGLU-Transformer IMU→EMG (few-shot)",
        meta: "Mihailovic et al. · 2026",
        summary: "Bridges IMU to EMG with few-shot learning for incomplete sensor setups.",
        href: scholar("GEGLU transformer IMU EMG few-shot 2026"),
      },
    ],
  },
];
