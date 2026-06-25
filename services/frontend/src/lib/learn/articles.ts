// Education Hub content. Realistic, plain-language patient education mapped to Mova's use cases
// (freezing of gait, rhythmic cueing, post-stroke recovery, range of motion, adherence). Educational
// only — not medical advice. Static reference data; no backend.

export interface ArticleSection {
  heading?: string;
  paragraphs: string[];
}

export interface Article {
  slug: string;
  category: "Freezing of Gait" | "Parkinson's" | "Stroke" | "Range of Motion" | "Habits";
  title: string;
  dek: string;
  readMinutes: number;
  hasVideo: boolean;
  sections: ArticleSection[];
  pullquote?: string;
}

export const ARTICLES: Article[] = [
  {
    slug: "understanding-freezing-of-gait",
    category: "Freezing of Gait",
    title: "Understanding Freezing of Gait",
    dek: "Why your feet feel glued to the floor — and what's happening in the brain when they do.",
    readMinutes: 6,
    hasVideo: true,
    pullquote:
      "Freezing is not weakness and it is not in your head — it is a breakdown in the brain's automatic stepping rhythm.",
    sections: [
      {
        paragraphs: [
          "Freezing of gait (FoG) is a brief, involuntary inability to step despite the intention to walk. Many people describe it as their feet being “glued” to the floor. Episodes most often strike when starting to walk, turning, passing through a doorway, or approaching a target like a chair.",
          "It is one of the most disabling symptoms of Parkinson's disease because it is unpredictable and a leading cause of falls. Understanding what triggers it is the first step to managing it.",
        ],
      },
      {
        heading: "What's happening in the brain",
        paragraphs: [
          "Walking is normally automatic — the basal ganglia generate a steady internal rhythm so you don't consciously plan each step. In Parkinson's, dopamine loss disrupts that internal timekeeper. When the demand on the system spikes (a turn, a narrow space, doing two things at once), the rhythm can momentarily collapse, and stepping stalls.",
          "This is why freezing often eases the moment an external rhythm or visual target is provided: it gives the motor system a cue to lock onto, bypassing the faulty internal one.",
        ],
      },
      {
        heading: "Recognising your triggers",
        paragraphs: [
          "Common triggers include turning, tight or cluttered spaces, dual-tasking (walking while talking), stress or time pressure, and the “destination effect” of nearing a goal. Keeping a simple log of when episodes happen helps you and your clinician find patterns and plan around them.",
        ],
      },
    ],
  },
  {
    slug: "why-rhythm-helps-parkinsons",
    category: "Parkinson's",
    title: "Why Rhythm Helps Parkinson's",
    dek: "The science of rhythmic auditory cueing, and why a steady beat can unlock smoother movement.",
    readMinutes: 5,
    hasVideo: true,
    pullquote: "A metronome doesn't fix the brain's clock — it lends you a working one.",
    sections: [
      {
        paragraphs: [
          "Rhythmic auditory stimulation (RAS) — stepping in time to a steady beat — is one of the most robust, evidence-backed tools in Parkinson's rehabilitation. A simple metronome can improve stride length, walking speed, and cadence, often within a single session.",
        ],
      },
      {
        heading: "Borrowing an external clock",
        paragraphs: [
          "Because Parkinson's degrades the internal rhythm generator, an external beat substitutes for it. The auditory system and the motor system are tightly coupled, so a sound the brain can anticipate gives movement something reliable to synchronise with.",
          "The effect is strongest when the tempo is matched to — or set slightly above — your comfortable cadence. Too slow and it drags; too fast and it overwhelms. Mova starts your metronome from your own baseline and lets you nudge it as you improve.",
        ],
      },
      {
        heading: "Making it a habit",
        paragraphs: [
          "Cueing works best when practised regularly and then gradually internalised. Short, frequent sessions beat occasional long ones. Over time, many people can recall the beat mentally to self-cue through a difficult moment.",
        ],
      },
    ],
  },
  {
    slug: "post-stroke-neuroplasticity",
    category: "Stroke",
    title: "Post-Stroke Neuroplasticity",
    dek: "How the brain rewires after a stroke — and why repetition and challenge are your best allies.",
    readMinutes: 7,
    hasVideo: false,
    pullquote: "The recovering brain rewards specificity: practise the movement you want to regain.",
    sections: [
      {
        paragraphs: [
          "Neuroplasticity is the brain's ability to reorganise itself by forming new connections. After a stroke, undamaged regions can gradually take on functions once handled by the injured area. Rehabilitation is, in essence, the deliberate use of this capacity.",
        ],
      },
      {
        heading: "The principles that drive recovery",
        paragraphs: [
          "Three principles matter most. Repetition: new circuits strengthen with use, and meaningful recovery takes hundreds of quality repetitions. Specificity: the brain adapts to exactly what you practise, so train the actual movements you want back. Challenge: tasks should be hard enough to demand effort but achievable enough to succeed — the “just-right” difficulty.",
          "Mova's reaching games are built around these principles: the targets adapt to your range so every rep is both achievable and challenging, and the volume is tracked so progress is visible.",
        ],
      },
      {
        heading: "Why early, consistent effort counts",
        paragraphs: [
          "Plasticity is heightened in the months after a stroke, but it does not switch off — gains are possible long afterward with sustained practice. Consistency is the multiplier: a little every day compounds far more than an occasional marathon session.",
        ],
      },
    ],
  },
  {
    slug: "range-of-motion-matters",
    category: "Range of Motion",
    title: "Why Range of Motion Is the Quiet Win",
    dek: "Before strength and speed, there's range. Why protecting and expanding it underpins every other gain.",
    readMinutes: 4,
    hasVideo: false,
    sections: [
      {
        paragraphs: [
          "Range of motion (ROM) is how far a joint can move through its natural arc. It's easy to overlook in favour of strength, but range is the foundation everything else is built on — you can't strengthen a movement you can't make.",
        ],
      },
      {
        heading: "Use it or lose it",
        paragraphs: [
          "Joints and soft tissue adapt to the range they're regularly taken through. Move a joint through its full arc often and it stays supple; spare it and the available range slowly shrinks. Gentle, frequent movement is the antidote.",
          "Mova measures a few key joint angles at intake to set your baseline, then tracks how that range changes session to session — so a small, steady improvement doesn't go unnoticed.",
        ],
      },
    ],
  },
  {
    slug: "consistency-over-intensity",
    category: "Habits",
    title: "Consistency Beats Intensity",
    dek: "The most effective rehab plan is the one you actually keep. How to build a streak that sticks.",
    readMinutes: 4,
    hasVideo: false,
    pullquote: "Ten focused minutes today beats an hour you keep postponing.",
    sections: [
      {
        paragraphs: [
          "The best exercise programme is not the most intense — it's the one you return to. Recovery is driven by accumulated quality practice over weeks and months, and that only happens if the habit survives busy days, low-energy days, and setbacks.",
        ],
      },
      {
        heading: "Designing for the bad days",
        paragraphs: [
          "Set a floor, not a ceiling: a minimum you'll do even when motivation is low. Anchor it to an existing routine (after breakfast, before the evening news). And make starting frictionless — Mova keeps your next session one tap away so the hardest part, beginning, is almost free.",
        ],
      },
    ],
  },
];

export function getArticle(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}
