import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExercisePhase, Quantifiability } from "@/lib/exercises/catalog";

import {
  exerciseHref,
  groupByPhase,
  heelSlidePrescriptionId,
  linesIn,
  phaseHeadingKey,
  phaseSegment,
  phaseShortKey,
  quantifiabilityKey,
  selectedSlug,
  sensorRoleKeys,
  startActionFor,
  textIn,
} from "./library.ts";

const ORDER: readonly (ExercisePhase | null)[] = ["A", "A-B", "B-C", "C", "A-C", null];

const entry = (slug: string, phase: ExercisePhase | null) => ({ slug, phase });

test("groups follow the phase order and keep catalog order inside a group", () => {
  const groups = groupByPhase(
    [
      entry("heel-slide", "A-B"),
      entry("seated-knee-flexion", null),
      entry("ankle-pumps", "A"),
      entry("short-arc-quad", "A-B"),
      entry("walking-gait", "A-C"),
      entry("step-up", "C"),
      entry("quad-set", "A"),
      entry("mini-squat", "B-C"),
    ],
    ORDER,
  );
  assert.deepEqual(
    groups.map((g) => [g.phase, g.entries.map((e) => e.slug)]),
    [
      ["A", ["ankle-pumps", "quad-set"]],
      ["A-B", ["heel-slide", "short-arc-quad"]],
      ["B-C", ["mini-squat"]],
      ["C", ["step-up"]],
      ["A-C", ["walking-gait"]],
      [null, ["seated-knee-flexion"]],
    ],
  );
});

test("a phase with no exercises gets no heading, and an empty catalog no groups", () => {
  const groups = groupByPhase([entry("step-up", "C"), entry("calf-raise", "A-B")], ORDER);
  assert.deepEqual(
    groups.map((g) => g.phase),
    ["A-B", "C"],
  );
  assert.deepEqual(groupByPhase([], ORDER), []);
});

test("a phase missing from the order is kept after the ordered groups, never dropped", () => {
  const groups = groupByPhase([entry("x", null), entry("y", "A")], ["A"]);
  assert.deepEqual(
    groups.map((g) => [g.phase, g.entries.map((e) => e.slug)]),
    [
      ["A", ["y"]],
      [null, ["x"]],
    ],
  );
});

test("every phase has a heading and a short label, the unlisted one included", () => {
  assert.equal(phaseHeadingKey("A"), "exerciseLibrary.phase.a");
  assert.equal(phaseHeadingKey("A-B"), "exerciseLibrary.phase.ab");
  assert.equal(phaseHeadingKey("B-C"), "exerciseLibrary.phase.bc");
  assert.equal(phaseHeadingKey("C"), "exerciseLibrary.phase.c");
  assert.equal(phaseHeadingKey("A-C"), "exerciseLibrary.phase.ac");
  assert.equal(phaseHeadingKey(null), "exerciseLibrary.phase.none");
  assert.equal(phaseShortKey("A-B"), "exerciseLibrary.phaseShort.ab");
  assert.equal(phaseShortKey(null), "exerciseLibrary.phaseShort.none");
  assert.deepEqual(
    ORDER.map((phase) => phaseSegment(phase)),
    ["a", "ab", "bc", "c", "ac", "none"],
  );
});

test("quantifiability reads in plain words, and an unstated class has no wording", () => {
  const cases: [Quantifiability | null, string | null][] = [
    ["FULL", "exerciseLibrary.quantifiability.full"],
    ["PARTIAL", "exerciseLibrary.quantifiability.partial"],
    ["FULL/PARTIAL", "exerciseLibrary.quantifiability.fullOrPartial"],
    ["COMPLETION_ONLY", "exerciseLibrary.quantifiability.completionOnly"],
    [null, null],
  ];
  for (const [value, key] of cases) assert.equal(quantifiabilityKey(value), key);
});

test("sensor roles reuse the shell's labels", () => {
  assert.deepEqual(sensorRoleKeys(["thigh", "shank", "foot"]), [
    "sensors.role.thigh",
    "sensors.role.shank",
    "sensors.role.foot",
  ]);
  assert.deepEqual(sensorRoleKeys([]), []);
});

test("the detail parameter names a known slug or nothing", () => {
  const known = (slug: string) => slug === "heel-slide" || slug === "quad-set";
  assert.equal(selectedSlug("quad-set", known), "quad-set");
  assert.equal(selectedSlug(" heel-slide ", known), "heel-slide");
  assert.equal(selectedSlug(["heel-slide", "quad-set"], known), "heel-slide");
  assert.equal(selectedSlug("unknown", known), null);
  assert.equal(selectedSlug("", known), null);
  assert.equal(selectedSlug([], known), null);
  assert.equal(selectedSlug(null, known), null);
  assert.equal(selectedSlug(undefined, known), null);
  assert.equal(exerciseHref("heel-slide"), "/exercises?exercise=heel-slide");
});

test("only Heel Slide with an active prescription can start; a failed read is not 'not prescribed'", () => {
  const rx = { status: "ok", prescriptionId: "0b7c0c52-5c7f-4d0e-9d1a-0f6f5a0c1e2d" } as const;
  assert.deepEqual(startActionFor("heel-slide", rx), {
    kind: "start",
    href: "/app/session/new/0b7c0c52-5c7f-4d0e-9d1a-0f6f5a0c1e2d",
  });
  assert.deepEqual(startActionFor("heel-slide", { status: "none" }), { kind: "notPrescribed" });
  assert.deepEqual(startActionFor("heel-slide", { status: "error" }), { kind: "unknown" });
  assert.deepEqual(startActionFor("heel-slide", { status: "ok", prescriptionId: "" }), { kind: "notPrescribed" });
  for (const slug of ["quad-set", "short-arc-quad", "walking-gait"]) {
    assert.deepEqual(startActionFor(slug, rx), { kind: "notPrescribed" });
    assert.deepEqual(startActionFor(slug, { status: "error" }), { kind: "notPrescribed" });
  }
});

test("the Heel Slide prescription is the first active row whose exercise is Heel Slide", () => {
  assert.equal(heelSlidePrescriptionId([]), null);
  assert.equal(
    heelSlidePrescriptionId([
      { id: "a", exercise: { slug: "quad-set" } },
      { id: "b", exercise: null },
      { id: "c", exercise: [{ slug: "heel-slide" }] },
      { id: "d", exercise: { slug: "heel-slide" } },
    ]),
    "c",
  );
  assert.equal(heelSlidePrescriptionId([{ id: "a", exercise: { slug: null } }]), null);
});

test("blank localized text is omitted, and a missing locale falls back to Russian", () => {
  assert.equal(textIn({ ru: "Сгибание", kk: "Бүгу", en: "Bend" }, "kk"), "Бүгу");
  assert.equal(textIn({ ru: "Сгибание", kk: "  ", en: "" }, "en"), "Сгибание");
  assert.equal(textIn({ ru: " ", kk: "", en: "" }, "ru"), null);
  assert.equal(textIn(null, "ru"), null);
  assert.deepEqual(
    linesIn(
      [
        { ru: "Один", kk: "Бір", en: "One" },
        { ru: "", kk: "", en: "" },
        { ru: "Три", kk: "", en: "Three" },
      ],
      "kk",
    ),
    ["Бір", "Три"],
  );
  assert.deepEqual(linesIn([], "ru"), []);
});
