/**
 * All landing copy in one place. Mirrors the Institute of Health section
 * structure 1:1, re-themed to Mova (camera-free motion intelligence for
 * movement rehabilitation). Swap copy/imagery here during personalisation.
 */

export const NAV_LINKS = [
  { label: "Capabilities", href: "#capabilities" },
  { label: "Research", href: "/research" },
  { label: "FAQ", href: "#faq" },
];

export const NAV_SECONDARY = [
  { label: "About", href: "#values" },
  { label: "Contact", href: "#cta" },
];

export const HERO = {
  heading: ["Motion intelligence", "for movement", "rehabilitation"],
  sub: "The only camera-free platform that turns everyday wearable motion into clinical-grade gait, balance and freezing-of-gait insight.",
  cta: "Learn More",
};

export const HERO_STATS = [
  { label: "Capture Rate", value: 50, suffix: " Hz" },
  { label: "Movement Biomarkers", value: 28, suffix: "" },
  { label: "Subjects Analysed", value: 1240, suffix: "" },
];

export const CAPABILITIES_INTRO = {
  heading: "Comprehensive, clinical-grade insight across the full arc of recovery.",
  cta: "Request access",
};

// Picsum seeds give stable, photographic placeholders out of the box.
// (Full colour now — swap for real gait/sensor/clinic assets in personalisation.)
const img = (seed: string, w = 900, h = 1100) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;

export const CAPABILITIES = [
  {
    title: "Gait Analysis",
    units: "Cadence · symmetry · stride",
    image: img("mova-gait"),
    overview:
      "Decompose every stride into cadence, symmetry, stride length and double-support time — from a single waist-worn IMU.",
  },
  {
    title: "Freezing of Gait",
    units: "Detect · forecast",
    image: img("mova-freeze"),
    overview:
      "Mova's core: detect and forecast freezing episodes in Parkinsonian gait, flagged seconds before they happen — at home or in clinic.",
  },
  {
    title: "Balance & Fall Risk",
    units: "Sway · stability",
    image: img("mova-balance"),
    overview:
      "Quantify postural sway and fall risk from quiet-stance and dynamic balance tasks — no force plate required.",
  },
  {
    title: "Tremor & Bradykinesia",
    units: "Amplitude · slowness",
    image: img("mova-tremor"),
    overview:
      "Characterise resting tremor amplitude and slowness of movement, and watch them respond to medication and therapy over time.",
  },
  {
    title: "At-Home Adherence",
    units: "Continuous · objective",
    image: img("mova-adherence"),
    overview:
      "See how much therapeutic movement actually happened between appointments — continuous, in-the-wild, and objective.",
  },
];

export const DIFFERENT = {
  heading: "What makes Mova different",
  slides: [
    {
      tag: "Camera-Free Capture",
      title: "Clinical-grade motion from a single wearable",
      body: "No camera, no markers, no motion lab. Mova reconstructs movement from one inertial sensor a patient already owns — turning a pocket phone or a research IMU into a full gait laboratory.",
      cta: "Explore Capabilities",
      image:
        "https://picsum.photos/seed/mova-wearable/1100/1300",
    },
    {
      tag: "Generalises Across Devices",
      title: "One foundation model, every patient and sensor",
      body: "Trained across public gait cohorts and hardware, Mova holds its accuracy whether the data comes from a wrist, a waist, a phone in a pocket, or a clinical-grade IMU — so results travel with the patient.",
      cta: "Explore Capabilities",
      image: "https://picsum.photos/seed/mova-devices/1100/1300",
    },
    {
      tag: "Continuous & Real-World",
      title: "Beyond the six-minute clinic snapshot",
      body: "Recovery doesn't pause between appointments. Mova moves monitoring out of the lab and into weeks of real life — continuous, in-the-wild signal you can actually trust.",
      cta: "Explore Capabilities",
      image: "https://picsum.photos/seed/mova-realworld/1100/1300",
    },
    {
      tag: "Research-Backed",
      title: "Validated, not cherry-picked",
      body: "Built on public movement-disorder cohorts and evaluated with strict leave-one-subject-out protocols. We report the numbers that hold up under scrutiny, not the demo that happened to work.",
      cta: "Read the Research",
      image: "https://picsum.photos/seed/mova-research/1100/1300",
    },
  ],
};

export const EMOTION = {
  line1: "If progress between visits has ever felt",
  emphasis: "invisible",
  line2: "— you're not alone.",
  descriptorsLead: "Care between appointments has always meant",
  descriptors: ["Guessing.", "Blind.", "Delayed.", "Subjective.", "Inconsistent.", "Alone."],
  transition:
    "What if every step a patient took outside the clinic became data you could trust?",
  resolveLead: "Movement leaves a trace.",
  resolve: "Now you can read it.",
  resolveSub: "Continuous, objective, clinical-grade — from a single sensor.",
};

export const VALUES = {
  heading: "Built for the ones who measure what others can't see.",
  pills: ["Real Signal", "Quiet Rigour", "Built Differently"],
  body: "At Mova, motion intelligence isn't about vanity dashboards or louder metrics. It's about turning everyday movement into evidence a clinician can act on — and a patient can feel.",
  cta: "About Us",
};

export const TESTIMONIALS_INTRO = {
  kicker: "Despite how far away this may feel",
  heading: "You're one step closer to care that finally sees the whole patient",
};

export const TESTIMONIALS = [
  { name: "Dr. Elena Reyes", role: "Movement Disorders Neurologist", seed: "t-elena" },
  { name: "James Okafor", role: "Senior Physiotherapist", seed: "t-james" },
  { name: "Dr. Mei Lin", role: "Rehabilitation Physician", seed: "t-mei" },
  { name: "Sofia Almeida", role: "Gait Lab Lead", seed: "t-sofia" },
  { name: "Dr. Tomas Hald", role: "Geriatric Medicine", seed: "t-tomas" },
  { name: "Priya Nair", role: "Clinical Researcher", seed: "t-priya" },
  { name: "Marcus Webb", role: "Neuro-rehab Specialist", seed: "t-marcus" },
  { name: "Dr. Hana Sato", role: "Parkinson's Care Lead", seed: "t-hana" },
];

export const FAQ = {
  heading: "Answers that help you decide with confidence",
  prompt: "Need help? Get in touch with us",
  cta: "Contact Us",
  items: [
    {
      q: "What exactly does Mova measure?",
      a: "Mova turns raw inertial motion into clinical-grade movement biomarkers: cadence, stride length and symmetry, double-support time, postural sway, turning, sit-to-stand power, tremor, and freezing-of-gait events. Instead of a single clinic snapshot, you get a continuous, longitudinal picture of how a patient actually moves.",
    },
    {
      q: "Do patients need special hardware?",
      a: "No. Mova is camera-free and device-agnostic. A single inertial sensor is enough — a research-grade IMU, a consumer wearable, or the phone already in a patient's pocket. One foundation model is trained to generalise across sensor types and placements, so you're not locked into proprietary hardware.",
    },
    {
      q: "How accurate is freezing-of-gait detection?",
      a: "Freezing-of-gait detection is evaluated with leave-one-subject-out validation on public movement-disorder cohorts — meaning the model is always tested on patients it has never seen. We report subject-independent AUROC rather than within-patient numbers, because that's what reflects real deployment.",
    },
    {
      q: "Does it work outside the clinic?",
      a: "That's the point. Mova is built for continuous, in-the-wild monitoring across weeks of recovery, not a six-minute walk test. Patients wear a sensor through everyday life and clinicians see the trends that a single appointment would miss.",
    },
    {
      q: "Is patient data private and secure?",
      a: "Movement signal is processed with privacy by design. Because Mova is camera-free, there's no video or imagery of the patient or their home — only motion. Data handling is built to align with clinical-grade privacy and security expectations.",
    },
  ],
};

export const FINAL_CTA = {
  kicker: "Motion is just the beginning",
  heading:
    "Clear, continuous, clinical-grade movement data starts with one conversation. Let's map your pathway — together.",
  cta: "Book a platform walkthrough",
};

export const FOOTER = {
  discover: ["Capabilities", "Research", "About", "Contact", "FAQ", "Sign in"],
  legals: ["Privacy Policy", "Cookie Policy", "Terms & Conditions"],
  socials: ["Instagram", "LinkedIn", "YouTube", "GitHub"],
  phone: "+1 (000) 000-0000",
  email: "hello@mova.health",
  copyright: "2026 © Mova",
};
