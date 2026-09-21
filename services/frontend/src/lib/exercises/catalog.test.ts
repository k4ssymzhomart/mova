import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { SENSOR_ROLES } from "../sensors/types.ts";
import {
  EXERCISE_CATALOG,
  type ExerciseEntry,
  exerciseBySlug,
  type Localized,
  localized,
  PHASE_ORDER,
} from "./catalog.ts";

const SLUGS = [
  "heel-slide",
  "seated-knee-flexion",
  "prone-knee-bend",
  "short-arc-quad",
  "straight-leg-raise",
  "ankle-pumps",
  "mini-squat",
  "quad-set",
  "calf-raise",
  "step-up",
  "walking-gait",
  "standing-hip-abduction",
  // From the PHOENIX signal/execution profiles rather than НТЗ Appendix A — see the note in catalog.ts.
  "ball-knee-flexion",
  "heel-slide-with-band",
  "supported-knee-raise",
  "seated-knee-extension",
  "resisted-ankle-pump",
  // The two PHOENIX profiles mova had no clinician clip for. They are in the library anyway; the missing
  // footage shows up as their absence from CONFIRMED_CLIPS below, which pins video and poster to null.
  "lying-partial-leg-raise",
  "lying-partial-leg-hold",
];

const SCORED = [
  "heel-slide",
  "seated-knee-flexion",
  "prone-knee-bend",
  "short-arc-quad",
  "straight-leg-raise",
  "ankle-pumps",
  "mini-squat",
  "quad-set",
  // The seven PHOENIX-profile exercises: each has a target, so each is scored. The two lying partial raises
  // are scored on thigh elevation, which is a target Phoenix states; having no reference clip does not make an
  // exercise unscorable, it only means the patient has nothing to watch.
  "ball-knee-flexion",
  "heel-slide-with-band",
  "supported-knee-raise",
  "seated-knee-extension",
  "resisted-ankle-pump",
  "lying-partial-leg-raise",
  "lying-partial-leg-hold",
];

const LOCALES = ["ru", "kk", "en"] as const;

function entry(slug: string): ExerciseEntry {
  const found = exerciseBySlug(slug);
  assert.ok(found, `missing ${slug}`);
  return found;
}

function texts(e: ExerciseEntry): Localized[] {
  return [
    e.name,
    ...(e.target ? [e.target] : []),
    ...(e.minValidExcursion ? [e.minValidExcursion] : []),
    ...(e.measures ? [e.measures] : []),
    ...e.cues,
    ...e.commonErrors,
  ];
}

test("the catalog holds exactly the nineteen slugs, each once", () => {
  const slugs = EXERCISE_CATALOG.map((e) => e.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.deepEqual([...slugs].sort(), [...SLUGS].sort());
});

test("every localized value is non-empty in ru, kk and en", () => {
  for (const e of EXERCISE_CATALOG) {
    for (const value of texts(e)) {
      for (const locale of LOCALES) {
        assert.ok(value[locale].trim().length > 0, `${e.slug}: empty ${locale} in ${JSON.stringify(value)}`);
      }
    }
    assert.ok(e.source.trim().length > 0, `${e.slug}: no source`);
  }
});

test("only heel-slide is prescribed", () => {
  assert.deepEqual(
    EXERCISE_CATALOG.filter((e) => e.prescribed).map((e) => e.slug),
    ["heel-slide"],
  );
});

test("the scored exercises are the eight of the scoring spec plus the seven PHOENIX-profile ones", () => {
  assert.deepEqual(
    EXERCISE_CATALOG.filter((e) => e.scored)
      .map((e) => e.slug)
      .sort(),
    [...SCORED].sort(),
  );
});

test("exercises outside the scoring spec have no target and no minimum excursion", () => {
  for (const e of EXERCISE_CATALOG.filter((x) => !x.scored)) {
    assert.equal(e.target, null, e.slug);
    assert.equal(e.minValidExcursion, null, e.slug);
  }
  for (const e of EXERCISE_CATALOG.filter((x) => x.scored)) {
    assert.ok(e.target, `${e.slug}: scored without a target`);
  }
});

test("quad-set is completion only, has no minimum excursion and says force is not measured", () => {
  const quad = entry("quad-set");
  assert.equal(quad.quantifiability, "COMPLETION_ONLY");
  assert.equal(quad.minValidExcursion, null);
  assert.ok(quad.target);
  assert.ok(quad.measures);
  assert.match(quad.measures.ru, /силу сокращения/i);
  assert.match(quad.measures.kk, /күшін/i);
  assert.match(quad.measures.en, /cannot measure/i);
  assert.match(quad.measures.en, /not graded/i);
});

test("ankle-pumps uses shank and foot and never mentions the knee in any language", () => {
  const ankle = entry("ankle-pumps");
  assert.deepEqual(ankle.sensors, ["shank", "foot"]);
  assert.ok(ankle.target);
  assert.ok(ankle.minValidExcursion);
  for (const value of texts(ankle)) {
    for (const locale of LOCALES) {
      assert.doesNotMatch(value[locale], /колен|тізе|knee/i, `${locale}: ${value[locale]}`);
    }
  }
  assert.doesNotMatch(ankle.source, /колен|тізе|knee/i);
});

test("phases and quantifiability follow НТЗ Appendix A", () => {
  const seated = entry("seated-knee-flexion");
  assert.equal(seated.phase, null);
  assert.equal(seated.quantifiability, null);
  assert.equal(entry("walking-gait").phase, "A-C");
  assert.equal(entry("mini-squat").quantifiability, "FULL/PARTIAL");
  assert.equal(entry("step-up").quantifiability, "FULL/PARTIAL");
  assert.equal(entry("heel-slide").phase, "A-B");
  assert.equal(entry("heel-slide").quantifiability, "FULL");
});

test("sensors are known roles, listed once each in role order", () => {
  for (const e of EXERCISE_CATALOG) {
    assert.equal(new Set(e.sensors).size, e.sensors.length, e.slug);
    const order = e.sensors.map((role) => SENSOR_ROLES.indexOf(role));
    assert.ok(
      order.every((index) => index >= 0),
      `${e.slug}: unknown role`,
    );
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${e.slug}: roles out of order`);
  }
});

// The clips confirmed against the exercise. A clip on the wrong exercise is worse than none, so a change here is a
// clinical decision, not a refactor. walking-gait.mp4 is a second camera angle of walking-gait-front-side, so it
// is deliberately on no entry.
const CONFIRMED_CLIPS: Record<string, string> = {
  "heel-slide": "heel-slide",
  "seated-knee-flexion": "seated-knee-flexion",
  "straight-leg-raise": "straight-leg-raise",
  "ankle-pumps": "ankle-dorsiflexion-strap",
  "quad-set": "quad-set",
  "step-up": "step-up",
  "walking-gait": "walking-gait-front-side",
  // Clips 2, 3, 8, 13 and 14 were the unattached ones. Five are now paired with the PHOENIX-profile
  // exercises; each pairing is a clinical decision listed in the pull request, not a refactor.
  // lying-partial-leg-raise and lying-partial-leg-hold are deliberately absent from this map: no clip of
  // either exercise was ever recorded, and their absence here is what pins their video and poster to null.
  "ball-knee-flexion": "seated-ball-roll",
  "heel-slide-with-band": "supine-knee-flexion-strap",
  "supported-knee-raise": "supine-bend-and-raise-strap",
  "seated-knee-extension": "seated-knee-extension",
  "resisted-ankle-pump": "ankle-dorsiflexion-band",
};

test("only the confirmed clips are attached, each with its own poster", () => {
  for (const e of EXERCISE_CATALOG) {
    const clip = CONFIRMED_CLIPS[e.slug];
    assert.equal(e.video, clip ? `/exercises/${clip}.mp4` : null, `${e.slug}: video`);
    assert.equal(e.poster, clip ? `/exercises/${clip}.jpg` : null, `${e.slug}: poster`);
  }
});

test("every attached clip and poster exists under public/", () => {
  for (const e of EXERCISE_CATALOG) {
    for (const path of [e.video, e.poster]) {
      if (path) assert.ok(existsSync(new URL(`../../../public${path}`, import.meta.url)), `${e.slug}: ${path} missing`);
    }
  }
});

test("cues are either absent or two to four", () => {
  for (const e of EXERCISE_CATALOG) {
    assert.ok(e.cues.length === 0 || (e.cues.length >= 2 && e.cues.length <= 4), `${e.slug}: ${e.cues.length} cues`);
  }
});

test("no text talks about points or scores", () => {
  for (const e of EXERCISE_CATALOG) {
    for (const value of texts(e)) {
      for (const locale of LOCALES) {
        assert.doesNotMatch(value[locale], /балл|ұпай|\bscore/i, `${e.slug} ${locale}: ${value[locale]}`);
      }
    }
  }
});

test("PHASE_ORDER lists each phase once and covers every phase in the catalog", () => {
  assert.deepEqual(PHASE_ORDER, ["A", "A-B", "B-C", "C", "A-C", null]);
  assert.equal(new Set(PHASE_ORDER).size, PHASE_ORDER.length);
  for (const e of EXERCISE_CATALOG) {
    assert.ok(PHASE_ORDER.includes(e.phase), `${e.slug}: phase ${e.phase} not ordered`);
  }
});

test("exerciseBySlug finds entries and returns undefined for unknown slugs", () => {
  assert.equal(exerciseBySlug("heel-slide")?.slug, "heel-slide");
  assert.equal(exerciseBySlug("bridge"), undefined);
  assert.equal(exerciseBySlug(""), undefined);
});

test("localized picks the requested language", () => {
  const name = entry("heel-slide").name;
  assert.equal(localized(name, "ru"), name.ru);
  assert.equal(localized(name, "kk"), name.kk);
  assert.equal(localized(name, "en"), name.en);
});
