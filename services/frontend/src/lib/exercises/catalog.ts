// The exercise library: the twelve exercises a patient can read about on /exercises. Every value is taken from
// one of two documents and each entry names where in its `source`:
//
//  - the scoring specification for eight exercises ("scoring spec"): the summary table in §3 (target,
//    min_valid_excursion, IMU) and the per-exercise sections of §4 (calibration, valid repetition, live
//    feedback), plus §10 and §16 where cited;
//  - the НТЗ v1.2: the Appendix A matrix (phase, quantifiability class, sensors, measurable metrics,
//    limitations), A.2 (the Heel Slide definition and its feedback whitelist) and §9.1 (the phase table).
//
// A field no source states is left empty (null or []), never filled in. The library describes exercises; it does
// not prescribe them (only Heel Slide is prescribed in this build) and nothing in it is a score.

import type { SensorRole } from "@/lib/sensors/types";

export type Localized = { ru: string; kk: string; en: string };

/** НТЗ §9.1 phases: A ≈ discharge to week 3, B ≈ weeks 4–6, C ≈ weeks 7–12. Appendix A writes ranges as "A–B". */
export type ExercisePhase = "A" | "A-B" | "B-C" | "C" | "A-C";

/** НТЗ §9.2 quantifiability_class, as the Appendix A matrix states it per exercise. */
export type Quantifiability = "FULL" | "PARTIAL" | "FULL/PARTIAL" | "COMPLETION_ONLY";

export interface ExerciseEntry {
  slug: string;
  name: Localized;
  /** null when the exercise is not in НТЗ Appendix A. */
  phase: ExercisePhase | null;
  /** null when no source states it. */
  quantifiability: Quantifiability | null;
  /** [] when no source names them. Listed in SENSOR_ROLES order. */
  sensors: SensorRole[];
  /** Human-readable target from the scoring spec; null when none. A target, never a measured value. */
  target: Localized | null;
  /** The smallest movement the scoring spec counts as a repetition; null when it does not apply or is not stated. */
  minValidExcursion: Localized | null;
  /**
   * What the sources say the three sensors can measure for this exercise (НТЗ Appendix A "Измеримые метрики",
   * scoring spec §4 and §10), with the limitations those sources state. It describes the specification, not what
   * this build computes: angles need the sensor calibration the specification describes.
   */
  measures: Localized | null;
  /**
   * A clinician-recorded reference clip under public/exercises, attached only where the clip is confirmed to show
   * this exercise; null otherwise. The file name is the clip's own, which is not always the slug.
   */
  video: string | null;
  /** The clip's poster frame: same file name, .jpg. */
  poster: string | null;
  /** 2–4 execution cues, only when traceable to a source; else []. */
  cues: Localized[];
  /** Only errors a source names; else []. */
  commonErrors: Localized[];
  /** true only for heel-slide. */
  prescribed: boolean;
  /** true for the eight exercises in the scoring spec. */
  scored: boolean;
  /** Document and section the entry is taken from. */
  source: string;
}

const SLIDE_TO_90: Localized = {
  ru: "Сгибание колена до 90°",
  kk: "Тізені 90°-қа дейін бүгу",
  en: "Knee bend to 90°",
};

const BEND_22_5: Localized = {
  ru: "Сгибание не меньше 22,5° от исходного положения",
  kk: "Бастапқы қалыптан кемінде 22,5° бүгу",
  en: "A bend of at least 22.5° from the starting position",
};

export const EXERCISE_CATALOG: readonly ExerciseEntry[] = [
  {
    slug: "heel-slide",
    name: { ru: "Скольжение пятки", kk: "Өкшені сырғыту", en: "Heel slide" },
    phase: "A-B",
    quantifiability: "FULL",
    sensors: ["thigh", "shank"],
    target: SLIDE_TO_90,
    minValidExcursion: BEND_22_5,
    measures: {
      ru: "Амплитуда сгибания колена (после калибровки датчиков), число повторений, темп и удержание",
      kk: "Тізенің бүгілу ауқымы (датчиктер калибрленгеннен кейін), қайталау саны, қарқын және ұстап тұру",
      en: "How far the knee bends (once the sensors are calibrated), the number of repetitions, tempo and hold",
    },
    video: "/exercises/heel-slide.mp4",
    poster: "/exercises/heel-slide.jpg",
    cues: [
      {
        ru: "Лёжа на спине, подтягивайте пятку к себе и возвращайте ногу в исходное положение",
        kk: "Шалқаңыздан жатып, өкшеңізді өзіңізге қарай тартып, аяғыңызды бастапқы қалпына қайтарыңыз",
        en: "Lying on your back, slide your heel towards you and return the leg to the starting position",
      },
      { ru: "Двигайтесь медленно", kk: "Баяу қозғалыңыз", en: "Move slowly" },
      {
        ru: "Удерживайте позицию в конце движения",
        kk: "Қозғалыс соңында қалыпты ұстап тұрыңыз",
        en: "Hold the position at the end of the movement",
      },
      {
        ru: "Не форсируйте движение через резкую боль",
        kk: "Қатты ауырсыну болса, қозғалысты күшпен жалғастырмаңыз",
        en: "Don't force the movement through sharp pain",
      },
    ],
    commonErrors: [
      {
        ru: "Рывок вместо плавного движения",
        kk: "Бірқалыпты қозғалыстың орнына кенет жұлқу",
        en: "A jerk instead of a smooth movement",
      },
      {
        ru: "Нога не возвращается в исходное положение",
        kk: "Аяқ бастапқы қалпына қайтпайды",
        en: "The leg does not return to the starting position",
      },
    ],
    prescribed: true,
    scored: true,
    source:
      "Scoring spec §3 (row 1), §4.1 Heel Slide, §9.1, §16; НТЗ v1.2 Appendix A (Heel Slide), A.2 (position, feedback whitelist, realtime_metrics)",
  },
  {
    slug: "seated-knee-flexion",
    name: { ru: "Сгибание колена сидя", kk: "Отырып тізені бүгу", en: "Seated knee bend" },
    phase: null,
    quantifiability: null,
    sensors: ["thigh", "shank"],
    target: SLIDE_TO_90,
    minValidExcursion: BEND_22_5,
    measures: {
      ru: "Амплитуда сгибания колена (после калибровки датчиков), темп, удержание и возврат в исходное положение",
      kk: "Тізенің бүгілу ауқымы (датчиктер калибрленгеннен кейін), қарқын, ұстап тұру және бастапқы қалыпқа қайту",
      en: "How far the knee bends (once the sensors are calibrated), tempo, hold and the return to the starting position",
    },
    video: "/exercises/seated-knee-flexion.mp4",
    poster: "/exercises/seated-knee-flexion.jpg",
    cues: [
      {
        ru: "Сидя, перед началом держите голень неподвижно 2–3 секунды",
        kk: "Отырып, бастамас бұрын сирағыңызды 2–3 секунд қозғалтпай ұстаңыз",
        en: "Sitting, keep your shin still for 2–3 seconds before you start",
      },
      {
        ru: "Двигайтесь плавно, не слишком быстро",
        kk: "Тым жылдам емес, бірқалыпты қозғалыңыз",
        en: "Move smoothly, not too fast",
      },
      {
        ru: "Удерживайте ногу в конечной точке",
        kk: "Соңғы нүктеде аяғыңызды ұстап тұрыңыз",
        en: "Hold the leg at the end point",
      },
      {
        ru: "Возвращайте ногу в исходное положение",
        kk: "Аяғыңызды бастапқы қалпына қайтарыңыз",
        en: "Return the leg to the starting position",
      },
    ],
    commonErrors: [{ ru: "Слишком быстрое движение", kk: "Тым жылдам қозғалыс", en: "Moving too fast" }],
    prescribed: false,
    scored: true,
    source: "Scoring spec §3 (row 2), §4.2 Seated Knee Flexion, §11; not in НТЗ v1.2 Appendix A",
  },
  {
    slug: "prone-knee-bend",
    name: { ru: "Сгибание колена лёжа на животе", kk: "Етпетінен жатып тізені бүгу", en: "Prone knee bend" },
    phase: "A-B",
    quantifiability: "FULL",
    sensors: ["thigh", "shank"],
    target: SLIDE_TO_90,
    minValidExcursion: BEND_22_5,
    measures: {
      ru: "Амплитуда сгибания колена (после калибровки датчиков), число повторений и темп",
      kk: "Тізенің бүгілу ауқымы (датчиктер калибрленгеннен кейін), қайталау саны және қарқын",
      en: "How far the knee bends (once the sensors are calibrated), the number of repetitions and tempo",
    },
    video: null,
    poster: null,
    cues: [
      {
        ru: "Лёжа на животе, перед началом держите прямую ногу неподвижно 2–3 секунды",
        kk: "Етпетіңізден жатып, бастамас бұрын түзу аяғыңызды 2–3 секунд қозғалтпай ұстаңыз",
        en: "Lying face down, keep the straight leg still for 2–3 seconds before you start",
      },
      { ru: "Двигайтесь плавно", kk: "Бірқалыпты қозғалыңыз", en: "Move smoothly" },
      {
        ru: "Опускайте ногу медленно, не бросайте её",
        kk: "Аяғыңызды баяу түсіріңіз, тастап жібермеңіз",
        en: "Lower the leg slowly, don't let it drop",
      },
    ],
    commonErrors: [
      {
        ru: "Нога падает при возврате вместо плавного опускания",
        kk: "Қайтарғанда аяқты баяу түсірудің орнына тастап жіберу",
        en: "Letting the leg drop on the way back instead of lowering it with control",
      },
    ],
    prescribed: false,
    scored: true,
    source: "Scoring spec §3 (row 3), §4.3 Prone Knee Bend; НТЗ v1.2 Appendix A (Prone Knee Bend)",
  },
  {
    slug: "short-arc-quad",
    name: { ru: "Разгибание колена на валике", kk: "Валик үстінде тізені жазу", en: "Short arc quad" },
    phase: "A-B",
    quantifiability: "FULL",
    sensors: ["thigh", "shank"],
    target: {
      ru: "Разгибание колена почти до прямой ноги: остаётся не больше 5° сгибания",
      kk: "Тізені толығымен дерлік жазу: бүгілуі 5°-тан аспауы керек",
      en: "Straighten the knee to within 5° of fully straight",
    },
    minValidExcursion: {
      ru: "Разгибание не меньше 10° или четверти пути до цели, если это больше",
      kk: "Кемінде 10° жазу немесе мақсатқа дейінгі жолдың төрттен бірі, егер ол көбірек болса",
      en: "Straightening by at least 10°, or by a quarter of the way to the target if that is more",
    },
    measures: {
      ru: "Разгибание колена (после калибровки датчиков), число повторений, удержание и темп",
      kk: "Тізенің жазылуы (датчиктер калибрленгеннен кейін), қайталау саны, ұстап тұру және қарқын",
      en: "How far the knee straightens (once the sensors are calibrated), the number of repetitions, hold and tempo",
    },
    video: null,
    poster: null,
    cues: [
      {
        ru: "Положите ногу на валик и перед началом не двигайте её 2–3 секунды",
        kk: "Аяғыңызды валикке қойып, бастамас бұрын 2–3 секунд қозғалтпаңыз",
        en: "Rest the leg on the roll and keep it still for 2–3 seconds before you start",
      },
      {
        ru: "Разогните колено и удерживайте ногу в конце движения",
        kk: "Тізеңізді жазып, қозғалыс соңында аяғыңызды ұстап тұрыңыз",
        en: "Straighten the knee and hold the leg at the end of the movement",
      },
      { ru: "Возвращайте ногу плавно", kk: "Аяғыңызды бірқалыпты қайтарыңыз", en: "Lower the leg back smoothly" },
    ],
    commonErrors: [],
    prescribed: false,
    scored: true,
    source: "Scoring spec §3 (row 4), §4.4 Short Arc Quad; НТЗ v1.2 Appendix A (Short Arc Quad / Quad Arc)",
  },
  {
    slug: "straight-leg-raise",
    name: { ru: "Подъём прямой ноги", kk: "Түзу аяқты көтеру", en: "Straight leg raise" },
    phase: "A-B",
    quantifiability: "PARTIAL",
    sensors: ["thigh", "shank"],
    target: {
      ru: "Подъём ноги на 30°, колено согнуто не больше чем на 10°",
      kk: "Аяқты 30°-қа көтеру, тізе 10°-тан артық бүгілмейді",
      en: "Raise the leg 30° with the knee bent no more than 10°",
    },
    minValidExcursion: {
      ru: "Подъём ноги не меньше чем на 10°",
      kk: "Аяқты кемінде 10°-қа көтеру",
      en: "Raising the leg by at least 10°",
    },
    measures: {
      ru: "Угол подъёма ноги (после калибровки датчиков), насколько прямым остаётся колено и число повторений. Силу мышц датчики не измеряют.",
      kk: "Аяқты көтеру бұрышы (датчиктер калибрленгеннен кейін), тізенің қаншалықты түзу қалатыны және қайталау саны. Бұлшықет күшін датчиктер өлшемейді.",
      en: "The angle the leg is raised to (once the sensors are calibrated), how straight the knee stays and the number of repetitions. The sensors do not measure muscle strength.",
    },
    video: "/exercises/straight-leg-raise.mp4",
    poster: "/exercises/straight-leg-raise.jpg",
    cues: [
      {
        ru: "Перед началом нога лежит прямо 2–3 секунды",
        kk: "Бастамас бұрын аяқ 2–3 секунд түзу жатсын",
        en: "Before you start, let the leg lie straight for 2–3 seconds",
      },
      {
        ru: "Держите колено прямым во время подъёма",
        kk: "Көтергенде тізеңізді түзу ұстаңыз",
        en: "Keep the knee straight while you lift",
      },
      {
        ru: "Удерживайте ногу в верхней точке",
        kk: "Аяғыңызды жоғарғы нүктеде ұстап тұрыңыз",
        en: "Hold the leg at the top",
      },
      { ru: "Опускайте ногу плавно", kk: "Аяғыңызды бірқалыпты түсіріңіз", en: "Lower the leg smoothly" },
    ],
    commonErrors: [
      { ru: "Колено сгибается во время подъёма", kk: "Көтергенде тізе бүгіледі", en: "The knee bends during the lift" },
    ],
    prescribed: false,
    scored: true,
    source: "Scoring spec §3 (row 5), §4.5 Straight Leg Raise; НТЗ v1.2 Appendix A (Straight Leg Raise)",
  },
  {
    slug: "ankle-pumps",
    name: { ru: "Сгибание и разгибание стопы", kk: "Аяқ басын бүгу және жазу", en: "Ankle pumps" },
    phase: "A",
    quantifiability: "FULL",
    sensors: ["shank", "foot"],
    target: {
      ru: "Общий размах движения стопы относительно голени — 20° за полный цикл",
      kk: "Толық циклде аяқ басының сирақпен салыстырғандағы жалпы қозғалыс ауқымы — 20°",
      en: "A total foot movement of 20° relative to the shin over one full cycle",
    },
    minValidExcursion: {
      ru: "Общий размах не меньше 8° за цикл",
      kk: "Бір циклде жалпы ауқым кемінде 8°",
      en: "A total range of at least 8° per cycle",
    },
    measures: {
      ru: "Размах движения стопы относительно голени (после калибровки датчиков), число повторений и темп",
      kk: "Аяқ басының сирақпен салыстырғандағы қозғалыс ауқымы (датчиктер калибрленгеннен кейін), қайталау саны және қарқын",
      en: "How far the foot moves relative to the shin (once the sensors are calibrated), the number of repetitions and tempo",
    },
    video: "/exercises/ankle-dorsiflexion-strap.mp4",
    poster: "/exercises/ankle-dorsiflexion-strap.jpg",
    cues: [
      {
        ru: "Перед началом держите стопу 2 секунды в удобном нейтральном положении",
        kk: "Бастамас бұрын аяқ басыңызды 2 секунд ыңғайлы бейтарап қалыпта ұстаңыз",
        en: "Before you start, hold the foot in a comfortable neutral position for 2 seconds",
      },
      {
        ru: "Делайте полный цикл: носок от себя и на себя",
        kk: "Толық цикл жасаңыз: аяқ ұшын өзіңізден әрі созып, өзіңізге қарай тартыңыз",
        en: "Make a full cycle: point the toes away, then pull them towards you",
      },
      {
        ru: "Двигайтесь ритмично и плавно",
        kk: "Ырғақты және бірқалыпты қозғалыңыз",
        en: "Keep a steady, smooth rhythm",
      },
    ],
    commonErrors: [
      { ru: "Слишком маленькое движение стопой", kk: "Аяқ басының қозғалысы тым аз", en: "Moving the foot too little" },
    ],
    prescribed: false,
    scored: true,
    source: "Scoring spec §3 (row 6), §4.6 Ankle Pumps; НТЗ v1.2 Appendix A (Ankle Pumps)",
  },
  {
    slug: "mini-squat",
    name: { ru: "Мини-приседание", kk: "Шағын отырып-тұру", en: "Mini squat" },
    phase: "B-C",
    quantifiability: "FULL/PARTIAL",
    sensors: ["thigh", "shank"],
    target: {
      ru: "Сгибание колена в диапазоне 25–35°",
      kk: "Тізені 25–35° аралығында бүгу",
      en: "Knee bend within 25–35°",
    },
    minValidExcursion: {
      ru: "Сгибание колена не меньше 10°",
      kk: "Тізені кемінде 10° бүгу",
      en: "A knee bend of at least 10°",
    },
    measures: {
      ru: "Амплитуда сгибания колена (после калибровки датчиков), темп, удержание и характер движения. Как вес распределяется между ногами, датчики не показывают.",
      kk: "Тізенің бүгілу ауқымы (датчиктер калибрленгеннен кейін), қарқын, ұстап тұру және қозғалыс сипаты. Салмақтың екі аяққа қалай түсетінін датчиктер көрсетпейді.",
      en: "How far the knee bends (once the sensors are calibrated), tempo, hold and the movement pattern. The sensors do not show how weight is shared between the legs.",
    },
    video: null,
    poster: null,
    cues: [
      {
        ru: "Перед началом постойте спокойно 2–3 секунды",
        kk: "Бастамас бұрын 2–3 секунд тыныш тұрыңыз",
        en: "Before you start, stand still for 2–3 seconds",
      },
      {
        ru: "Приседайте неглубоко, не глубже заданного диапазона",
        kk: "Терең отырмаңыз: берілген аралықтан төмен түспеңіз",
        en: "Keep the squat shallow, no deeper than the set range",
      },
      {
        ru: "Двигайтесь плавно вниз и вверх",
        kk: "Төмен және жоғары бірқалыпты қозғалыңыз",
        en: "Move smoothly down and up",
      },
      {
        ru: "Возвращайтесь в исходное положение",
        kk: "Бастапқы қалпыңызға оралыңыз",
        en: "Return to the starting position",
      },
    ],
    commonErrors: [
      {
        ru: "Приседание глубже заданного диапазона",
        kk: "Берілген аралықтан тереңірек отыру",
        en: "Squatting deeper than the set range",
      },
    ],
    prescribed: false,
    scored: true,
    source: "Scoring spec §3 (row 7), §4.7 Mini Squat; НТЗ v1.2 Appendix A (Mini-Squat)",
  },
  {
    slug: "quad-set",
    name: { ru: "Напряжение мышцы бедра", kk: "Сан бұлшықетін қатайту", en: "Quad set" },
    phase: "A",
    quantifiability: "COMPLETION_ONLY",
    sensors: ["thigh", "shank"],
    target: {
      ru: "Удержание 5 секунд, нога неподвижна (колено сдвигается не больше чем на 5°)",
      kk: "5 секунд ұстап тұру, аяқ қозғалмайды (тізе 5°-тан артық жылжымайды)",
      en: "Hold for 5 seconds with the leg still (the knee moves no more than 5°)",
    },
    minValidExcursion: null,
    measures: {
      ru: "Время удержания и неподвижность ноги. Силу сокращения мышцы бедра датчики измерить не могут, поэтому техника не оценивается.",
      kk: "Ұстап тұру уақыты және аяқтың қозғалыссыз тұруы. Сан бұлшықетінің жиырылу күшін датчиктер өлшей алмайды, сондықтан техника бағаланбайды.",
      en: "Hold time and how still the leg stays. The sensors cannot measure how strongly the thigh muscle contracts, so technique is not graded.",
    },
    video: "/exercises/quad-set.mp4",
    poster: "/exercises/quad-set.jpg",
    cues: [
      {
        ru: "Перед началом держите ногу неподвижно 2–3 секунды",
        kk: "Бастамас бұрын аяғыңызды 2–3 секунд қозғалтпай ұстаңыз",
        en: "Before you start, keep the leg still for 2–3 seconds",
      },
      {
        ru: "Удерживайте положение 5 секунд",
        kk: "Қалыпты 5 секунд ұстап тұрыңыз",
        en: "Hold the position for 5 seconds",
      },
      {
        ru: "Во время удержания не двигайте ногой",
        kk: "Ұстап тұрғанда аяғыңызды қозғалтпаңыз",
        en: "Keep the leg still during the hold",
      },
    ],
    commonErrors: [
      { ru: "Нога двигается во время удержания", kk: "Ұстап тұрғанда аяқ қозғалады", en: "The leg moves during the hold" },
    ],
    prescribed: false,
    scored: true,
    source:
      "Scoring spec §3 (row 8), §4.8 Quad Set (limitation: contraction force is not computed from the 6-axis IMU), §10; НТЗ v1.2 §11.5, §11.8, Appendix A (Quad Set)",
  },
  {
    slug: "calf-raise",
    name: { ru: "Подъём на носки", kk: "Аяқ ұшына көтерілу", en: "Calf raise" },
    phase: "A-B",
    quantifiability: "PARTIAL",
    sensors: ["shank", "foot"],
    target: null,
    minValidExcursion: null,
    measures: {
      ru: "Размах движения в голеностопе (после калибровки датчиков), число повторений и темп. Равновесие датчики на одной ноге полностью не оценивают.",
      kk: "Тобықтағы қозғалыс ауқымы (датчиктер калибрленгеннен кейін), қайталау саны және қарқын. Бір аяқтағы датчиктер тепе-теңдікті толық бағалай алмайды.",
      en: "How far the ankle moves (once the sensors are calibrated), the number of repetitions and tempo. Sensors on one leg cannot fully assess balance.",
    },
    video: null,
    poster: null,
    cues: [],
    commonErrors: [],
    prescribed: false,
    scored: false,
    source: "НТЗ v1.2 Appendix A (Calf Raise); not in the scoring spec",
  },
  {
    slug: "step-up",
    name: { ru: "Шаг на ступеньку", kk: "Баспалдаққа көтерілу", en: "Step-up" },
    phase: "C",
    quantifiability: "FULL/PARTIAL",
    sensors: ["thigh", "shank", "foot"],
    target: null,
    minValidExcursion: null,
    measures: {
      ru: "Цикл шага, сгибание и разгибание колена (после калибровки датчиков), моменты постановки и отрыва стопы и темп",
      kk: "Қадам циклі, тізенің бүгілуі мен жазылуы (датчиктер калибрленгеннен кейін), аяқ басының қойылу және көтерілу сәттері және қарқын",
      en: "The step cycle, how the knee bends and straightens (once the sensors are calibrated), when the foot lands and lifts off, and tempo",
    },
    video: "/exercises/step-up.mp4",
    poster: "/exercises/step-up.jpg",
    cues: [],
    commonErrors: [],
    prescribed: false,
    scored: false,
    source: "НТЗ v1.2 Appendix A (Step-Up); not in the scoring spec",
  },
  {
    slug: "walking-gait",
    name: { ru: "Ходьба", kk: "Жүру", en: "Walking" },
    phase: "A-C",
    quantifiability: "PARTIAL",
    sensors: ["thigh", "shank", "foot"],
    target: null,
    minValidExcursion: null,
    measures: {
      ru: "Частота шагов, длительность цикла шага, примерное соотношение опоры и переноса ноги и размах движения колена (после калибровки датчиков). Длину шага и скорость без отдельной проверки метода не оценивают, симметрию двух ног не оценивают.",
      kk: "Қадам жиілігі, қадам циклінің ұзақтығы, тірек пен аяқты алға апарудың шамамен арақатынасы және тізе қозғалысының ауқымы (датчиктер калибрленгеннен кейін). Қадам ұзындығы мен жылдамдық әдіс бөлек тексерілмейінше бағаланбайды, екі аяқтың симметриясы бағаланбайды.",
      en: "Step rate, gait cycle time, an estimate of stance and swing, and how far the knee moves (once the sensors are calibrated). Step length and speed are not assessed until the method has been separately validated, and symmetry between the two legs is not assessed.",
    },
    video: "/exercises/walking-gait-front-side.mp4",
    poster: "/exercises/walking-gait-front-side.jpg",
    cues: [],
    commonErrors: [],
    prescribed: false,
    scored: false,
    source: "НТЗ v1.2 Appendix A (Walking / Gait assessment), §9.1; not in the scoring spec",
  },
  {
    slug: "standing-hip-abduction",
    name: { ru: "Отведение ноги в сторону стоя", kk: "Тұрып аяқты бүйірге апару", en: "Standing hip abduction" },
    phase: "B-C",
    quantifiability: "PARTIAL",
    sensors: ["thigh", "shank"],
    target: null,
    minValidExcursion: null,
    measures: {
      ru: "Размах движения бедра (после калибровки датчиков), устойчивость колена и число повторений. Без датчика на тазу наклоны корпуса оцениваются лишь ограниченно.",
      kk: "Санның қозғалыс ауқымы (датчиктер калибрленгеннен кейін), тізенің тұрақтылығы және қайталау саны. Жамбаста датчик жоқ, сондықтан дененің еңкеюі шектеулі ғана бағаланады.",
      en: "How far the thigh moves (once the sensors are calibrated), how steady the knee stays and the number of repetitions. With no sensor on the pelvis, leaning of the body can only be partly assessed.",
    },
    video: null,
    poster: null,
    cues: [],
    commonErrors: [],
    prescribed: false,
    scored: false,
    source: "НТЗ v1.2 Appendix A (Standing Hip Abduction); not in the scoring spec",
  },

  // — from the PHOENIX signal and execution profiles ————————————————————————————————————————————————
  // The five below come from Phoenix's exercise_signals.py and execution_score.py (vendored into
  // services/imu-tools), not from НТЗ Appendix A or the scoring docx. Phoenix states no recovery phase and no
  // quantifiability class for any of them, so both stay null rather than being invented here — those are clinical
  // classifications. Each reuses a clinician-recorded clip that was already in public/exercises and attached to
  // nothing; every pairing is listed in the pull request as a clinical decision to confirm.
  {
    slug: "ball-knee-flexion",
    name: { ru: "Сгибание колена с мячом", kk: "Доппен тізені бүгу", en: "Ball knee flexion" },
    phase: null,
    quantifiability: null,
    sensors: ["thigh", "shank"],
    target: SLIDE_TO_90,
    minValidExcursion: BEND_22_5,
    measures: {
      ru: "Амплитуда сгибания колена (после калибровки датчиков), число повторений и темп",
      kk: "Тізенің бүгілу ауқымы (датчиктер калибрленгеннен кейін), қайталау саны және қарқын",
      en: "How far the knee bends (once the sensors are calibrated), the number of repetitions and tempo",
    },
    video: "/exercises/seated-ball-roll.mp4",
    poster: "/exercises/seated-ball-roll.jpg",
    cues: [
      {
        ru: "Сидя, катите мяч стопой к себе, сгибая колено",
        kk: "Отырып, допты аяғыңызбен өзіңізге қарай домалатып, тізеңізді бүгіңіз",
        en: "Seated, roll the ball towards you with your foot, bending the knee",
      },
      { ru: "Двигайтесь медленно", kk: "Баяу қозғалыңыз", en: "Move slowly" },
      {
        ru: "Возвращайте ногу в исходное положение так же плавно",
        kk: "Аяқты бастапқы қалпына дәл сондай бірқалыпты қайтарыңыз",
        en: "Return the leg to the starting position just as smoothly",
      },
    ],
    commonErrors: [
      {
        ru: "Стопа соскальзывает с мяча",
        kk: "Аяқ доптан сырғып кетеді",
        en: "The foot slips off the ball",
      },
      {
        ru: "Рывок вместо плавного движения",
        kk: "Бірқалыпты қозғалыстың орнына кенет жұлқу",
        en: "A jerk instead of a smooth movement",
      },
    ],
    prescribed: false,
    scored: true,
    source:
      "Phoenix feat/llm-feedback-two-tier: exercise_signals.py (exercise-ball-knee-flexion-v1), execution_score.py, migration 0023_execution_score_exercises.sql; not in НТЗ v1.2 Appendix A",
  },
  {
    slug: "heel-slide-with-band",
    name: { ru: "Скольжение пятки с лентой", kk: "Таспамен өкшені сырғыту", en: "Heel slide with band" },
    phase: null,
    quantifiability: null,
    sensors: ["thigh", "shank"],
    target: SLIDE_TO_90,
    minValidExcursion: BEND_22_5,
    measures: {
      ru: "Амплитуда сгибания колена (после калибровки датчиков), число повторений, темп и удержание",
      kk: "Тізенің бүгілу ауқымы (датчиктер калибрленгеннен кейін), қайталау саны, қарқын және ұстап тұру",
      en: "How far the knee bends (once the sensors are calibrated), the number of repetitions, tempo and hold",
    },
    video: "/exercises/supine-knee-flexion-strap.mp4",
    poster: "/exercises/supine-knee-flexion-strap.jpg",
    cues: [
      {
        ru: "Лёжа на спине, подтягивайте пятку к себе, помогая себе лентой",
        kk: "Шалқаңыздан жатып, таспаның көмегімен өкшеңізді өзіңізге қарай тартыңыз",
        en: "Lying on your back, slide your heel towards you, helping yourself with the band",
      },
      {
        ru: "Лента помогает движению, а не тянет ногу за вас",
        kk: "Таспа қозғалысқа көмектеседі, аяқты сіздің орныңызға тартпайды",
        en: "The band assists the movement; it does not pull the leg for you",
      },
      {
        ru: "Не форсируйте движение через резкую боль",
        kk: "Қатты ауырсыну болса, қозғалысты күшпен жалғастырмаңыз",
        en: "Don't force the movement through sharp pain",
      },
    ],
    commonErrors: [
      {
        ru: "Лента тянет ногу вместо работы мышц",
        kk: "Бұлшықеттің жұмысының орнына аяқты таспа тартады",
        en: "The band pulls the leg instead of the muscles working",
      },
      {
        ru: "Нога не возвращается в исходное положение",
        kk: "Аяқ бастапқы қалпына қайтпайды",
        en: "The leg does not return to the starting position",
      },
    ],
    prescribed: false,
    scored: true,
    source:
      "Phoenix feat/llm-feedback-two-tier: exercise_signals.py (exercise-heel-slide-with-band-v1), execution_score.py, migration 0023_execution_score_exercises.sql; not in НТЗ v1.2 Appendix A",
  },
  {
    slug: "supported-knee-raise",
    name: { ru: "Подъём колена с поддержкой", kk: "Тіректі тізе көтеру", en: "Supported knee raise" },
    phase: null,
    quantifiability: null,
    sensors: ["thigh", "shank", "foot"],
    target: {
      ru: "Сгибание колена до 60° с удержанием в верхней точке",
      kk: "Тізені 60°-қа дейін бүгіп, жоғарғы нүктеде ұстап тұру",
      en: "Knee bend to 60°, held at the top",
    },
    minValidExcursion: {
      ru: "Сгибание не меньше 15° от исходного положения",
      kk: "Бастапқы қалыптан кемінде 15° бүгу",
      en: "A bend of at least 15° from the starting position",
    },
    measures: {
      ru: "Амплитуда сгибания колена (после калибровки датчиков), удержание в верхней точке, число повторений и темп",
      kk: "Тізенің бүгілу ауқымы (датчиктер калибрленгеннен кейін), жоғарғы нүктеде ұстап тұру, қайталау саны және қарқын",
      en: "How far the knee bends (once the sensors are calibrated), the hold at the top, the number of repetitions and tempo",
    },
    video: "/exercises/supine-bend-and-raise-strap.mp4",
    poster: "/exercises/supine-bend-and-raise-strap.jpg",
    cues: [
      {
        ru: "Лёжа на спине, поднимайте согнутое колено, придерживая ногу",
        kk: "Шалқаңыздан жатып, бүгілген тізеңізді аяқты ұстап тұрып көтеріңіз",
        en: "Lying on your back, raise the bent knee while supporting the leg",
      },
      {
        ru: "Задержитесь в верхней точке, затем медленно опустите",
        kk: "Жоғарғы нүктеде сәл тұрыңыз, содан кейін баяу түсіріңіз",
        en: "Pause at the top, then lower slowly",
      },
      {
        ru: "Не задерживайте дыхание",
        kk: "Тыныс алуды тоқтатпаңыз",
        en: "Don't hold your breath",
      },
    ],
    commonErrors: [
      {
        ru: "Нога опускается рывком",
        kk: "Аяқ кенет түсіп кетеді",
        en: "The leg drops instead of lowering",
      },
      {
        ru: "Нет паузы в верхней точке",
        kk: "Жоғарғы нүктеде кідіріс жоқ",
        en: "No pause at the top",
      },
    ],
    prescribed: false,
    scored: true,
    source:
      "Phoenix feat/llm-feedback-two-tier: exercise_signals.py (exercise-supported-knee-raise-v1), execution_score.py (top hold 0.5 s), migration 0023_execution_score_exercises.sql; not in НТЗ v1.2 Appendix A",
  },
  {
    slug: "seated-knee-extension",
    name: { ru: "Разгибание колена сидя", kk: "Отырып тізені жазу", en: "Seated knee extension" },
    phase: null,
    quantifiability: null,
    sensors: ["thigh", "shank"],
    target: {
      ru: "Разгибание колена до угла не больше 10° сгибания",
      kk: "Тізені бүгілуі 10°-тан аспайтындай етіп жазу",
      en: "Knee straightening to within 10° of full extension",
    },
    minValidExcursion: {
      ru: "Разгибание не меньше 20° от исходного положения",
      kk: "Бастапқы қалыптан кемінде 20° жазу",
      en: "A straightening of at least 20° from the starting position",
    },
    measures: {
      ru: "Амплитуда разгибания колена (после калибровки датчиков), удержание, число повторений и темп",
      kk: "Тізенің жазылу ауқымы (датчиктер калибрленгеннен кейін), ұстап тұру, қайталау саны және қарқын",
      en: "How far the knee straightens (once the sensors are calibrated), the hold, the number of repetitions and tempo",
    },
    video: "/exercises/seated-knee-extension.mp4",
    poster: "/exercises/seated-knee-extension.jpg",
    cues: [
      {
        ru: "Сидя на стуле, выпрямляйте колено до горизонтали",
        kk: "Орындықта отырып, тізеңізді көлденең күйге дейін жазыңыз",
        en: "Sitting on a chair, straighten the knee to horizontal",
      },
      {
        ru: "Задержитесь в конце движения, затем медленно опустите",
        kk: "Қозғалыс соңында сәл тұрыңыз, содан кейін баяу түсіріңіз",
        en: "Hold at the end of the movement, then lower slowly",
      },
      {
        ru: "Держите бедро прижатым к сиденью",
        kk: "Саныңызды отырғышқа тигізіп ұстаңыз",
        en: "Keep the thigh resting on the seat",
      },
    ],
    commonErrors: [
      {
        ru: "Бедро поднимается вместе с голенью",
        kk: "Сан балтырмен бірге көтеріледі",
        en: "The thigh lifts along with the shin",
      },
      {
        ru: "Колено не доходит до конца движения",
        kk: "Тізе қозғалыстың соңына жетпейді",
        en: "The knee does not reach the end of the movement",
      },
    ],
    prescribed: false,
    scored: true,
    source:
      "Phoenix feat/llm-feedback-two-tier: exercise_signals.py (exercise-seated-knee-extension-v1), execution_score.py (tempo 1.2 s, hold 0.8 s, return 1.1 s — the only one of these five with targets calibrated from reference takes); not in НТЗ v1.2 Appendix A",
  },
  {
    slug: "resisted-ankle-pump",
    name: { ru: "Движения стопой с сопротивлением", kk: "Кедергімен аяқ басының қозғалысы", en: "Resisted ankle pump" },
    phase: null,
    quantifiability: null,
    sensors: ["shank", "foot"],
    target: {
      ru: "Полные циклы движения стопы с размахом не меньше 20°",
      kk: "Аяқ басының ауқымы кемінде 20° болатын толық циклдері",
      en: "Full ankle cycles with a range of at least 20°",
    },
    minValidExcursion: {
      ru: "Движение стопы не меньше 8° за полный цикл",
      kk: "Толық циклде аяқ басының қозғалысы кемінде 8°",
      en: "Ankle movement of at least 8° over a full cycle",
    },
    measures: {
      ru: "Размах движения стопы (после калибровки датчиков), число полных циклов и темп",
      kk: "Аяқ басының қозғалыс ауқымы (датчиктер калибрленгеннен кейін), толық цикл саны және қарқын",
      en: "How far the ankle moves (once the sensors are calibrated), the number of full cycles and tempo",
    },
    video: "/exercises/ankle-dorsiflexion-band.mp4",
    poster: "/exercises/ankle-dorsiflexion-band.jpg",
    cues: [
      {
        ru: "Тяните носок на себя и от себя, преодолевая сопротивление ленты",
        kk: "Таспаның кедергісін жеңе отырып, ұшыңызды өзіңізге және өзіңізден тартыңыз",
        en: "Pull the toes towards you and away, working against the band",
      },
      {
        ru: "Двигайте только стопой, голень остаётся на месте",
        kk: "Тек аяқ басын қозғалтыңыз, балтыр орнында қалады",
        en: "Move only the foot; the shin stays where it is",
      },
      {
        ru: "Проходите полный размах в обе стороны",
        kk: "Екі бағытта да толық ауқымды өтіңіз",
        en: "Go through the full range in both directions",
      },
    ],
    commonErrors: [
      {
        ru: "Движение идёт за счёт всей ноги, а не стопы",
        kk: "Қозғалыс аяқ басының емес, бүкіл аяқтың есебінен болады",
        en: "The whole leg moves instead of the foot",
      },
      {
        ru: "Неполный размах движения",
        kk: "Қозғалыс ауқымы толық емес",
        en: "An incomplete range of movement",
      },
    ],
    prescribed: false,
    scored: true,
    source:
      "Phoenix feat/llm-feedback-two-tier: exercise_signals.py (exercise-resisted-ankle-pump-v1), execution_score.py (no ROM target — prescribed cycles only), migration 0023_execution_score_exercises.sql; not in НТЗ v1.2 Appendix A. Minimum excursion follows mova's own ankle-pumps entry (8° per full cycle); Phoenix's profile uses 4° because it counts one direction of the pump only, and says that is unvalidated on hardware",
  },
];

const BY_SLUG: ReadonlyMap<string, ExerciseEntry> = new Map(EXERCISE_CATALOG.map((entry) => [entry.slug, entry]));

export function exerciseBySlug(slug: string): ExerciseEntry | undefined {
  return BY_SLUG.get(slug);
}

/** Display order for grouping by phase; exercises outside НТЗ Appendix A (phase null) come last. */
export const PHASE_ORDER: readonly (ExercisePhase | null)[] = ["A", "A-B", "B-C", "C", "A-C", null];

export function localized(value: Localized, locale: "ru" | "kk" | "en"): string {
  return value[locale];
}
