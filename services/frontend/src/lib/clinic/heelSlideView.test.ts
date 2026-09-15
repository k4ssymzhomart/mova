import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStoredProxySeries } from "../motion/flexion.ts";
import { countOrientedRepetitions, heelSlideThresholds } from "../motion/reps.ts";
import {
  buildHeelSlideView,
  deliveredHz,
  downsampleMinMax,
  formatDecimal,
  hexCode,
  isUuid,
  type MotionDeps,
  niceTicks,
  parseCheckIn,
  parseRateReadout,
  parseSessionList,
  pickHeelSlideSession,
  type ReviewSessionItem,
} from "./heelSlideView.ts";

const MOTION: MotionDeps = { buildStoredProxySeries, countOrientedRepetitions, heelSlideThresholds };

const PATIENT = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const OLDER = "33333333-3333-4333-8333-333333333333";
const OTHER_EXERCISE = "44444444-4444-4444-8444-444444444444";

const RUBRIC = {
  schema: "exercise_config/heel_slide_path.v1",
  min_valid_excursion_deg: 22.5,
  reps: 10,
  sensors: ["thigh", "shank"],
};

function listItem(id: string, startedAt: string, slug: string | null): ReviewSessionItem {
  return { id, startedAt, endedAt: null, status: "completed", exerciseSlug: slug, exerciseName: null, hasCheckIn: false };
}

/**
 * A stored session at `hz`: the leg rests straight, then `reps` slow heel slides of `peakDeg` of relative
 * orientation, each followed by a rest. The thigh sits near +175 degrees of pitch, so the shank crosses the
 * +/-180 seam on every bend. The shank sensor notifies `skewMs` after the thigh.
 */
function storedSession({ hz = 50, reps = 10, peakDeg = 60, restS = 1.5, repS = 2, skewMs = 6 } = {}) {
  const thigh: [number, number][] = [];
  const shank: [number, number][] = [];
  const t0 = Date.parse("2026-09-15T08:00:00Z");
  const cycleS = repS + restS;
  const totalS = restS + reps * cycleS;
  const n = Math.round(totalS * hz);
  for (let i = 0; i < n; i += 1) {
    const tS = i / hz;
    const inCycle = tS - restS;
    let bend = 0;
    if (inCycle >= 0) {
      const phase = inCycle % cycleS;
      if (phase < repS) bend = peakDeg * Math.sin((Math.PI * phase) / repS);
    }
    const thighPitch = 175 + 0.3 * Math.sin(i * 0.7);
    const shankRaw = thighPitch + bend;
    const shankPitch = shankRaw > 180 ? shankRaw - 360 : shankRaw;
    const tMs = t0 + i * (1000 / hz);
    thigh.push([tMs, thighPitch]);
    shank.push([tMs + skewMs, shankPitch]);
  }
  return { thigh, shank, t0 };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  const { thigh, shank } = storedSession();
  return {
    session: {
      id: SESSION,
      patient_id: PATIENT,
      status: "completed",
      started_at: "2026-09-15T07:59:30Z",
      ended_at: "2026-09-15T08:00:42Z",
      device_info: {
        transport: "web-bluetooth",
        roles: {
          thigh: { device_id: "a", device_name: "WT901-A", rate: { requestedHz: 50, confirmed: true } },
          shank: { device_id: "b", device_name: "WT901-B", rate: { requestedHz: 50, confirmed: false, readbackCode: 6, failure: "mismatch" } },
          foot: { device_id: "c", device_name: "WT901-C", rate: null },
        },
      },
      summary: { kind: "heel_slide_path.v1", reps_counted_on_device: 9, telemetry: { pending_at_finish: 0 } },
    },
    exercise: { slug: "heel-slide", name: "Heel Slide", scoring_rubric: RUBRIC, default_dose: { reps: 12 } },
    prescription: { id: OLDER, status: "active", dose: { reps: 10 } },
    patient: { id: PATIENT, name: "test.patient" },
    check_in: {
      pain_before: 2,
      pain_after: 3,
      difficulty: 4,
      knee_feels: "same",
      symptoms: ["redness", "other"],
      other_note: "stiff in the morning",
      language: "ru",
      submitted_at: "2026-09-15T08:01:10Z",
    },
    frames: { thigh, shank, foot_count: thigh.length },
    frame_counts: { thigh: thigh.length, shank: shank.length + 2, foot: thigh.length },
    ...overrides,
  };
}

test("uuids are recognised; anything else is not", () => {
  assert.equal(isUuid(SESSION), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid(undefined), false);
});

test("the session list maps rows and keeps null for an unauthorised caller", () => {
  assert.equal(parseSessionList(null), null);
  const list = parseSessionList([
    { id: SESSION, started_at: "2026-09-15T08:00:00Z", ended_at: null, status: "in_progress", exercise_slug: "heel-slide", exercise_name: "Heel Slide", has_check_in: true },
    { id: "bad", started_at: "2026-09-15T08:00:00Z" },
    { id: OLDER, status: "weird", exercise_slug: null },
  ]);
  assert.deepEqual(list, [
    { id: SESSION, startedAt: "2026-09-15T08:00:00Z", endedAt: null, status: "in_progress", exerciseSlug: "heel-slide", exerciseName: "Heel Slide", hasCheckIn: true },
    { id: OLDER, startedAt: null, endedAt: null, status: null, exerciseSlug: null, exerciseName: null, hasCheckIn: false },
  ]);
  assert.deepEqual(parseSessionList([]), []);
});

test("the newest Heel Slide session is picked by default; other exercises never are", () => {
  const list = [
    listItem(OTHER_EXERCISE, "2026-09-15T09:00:00Z", "reaching"),
    listItem(OLDER, "2026-09-14T08:00:00Z", "heel-slide"),
    listItem(SESSION, "2026-09-15T08:00:00Z", "heel-slide"),
  ];
  const pick = pickHeelSlideSession(list, undefined);
  assert.equal(pick.kind, "selected");
  assert.equal(pick.kind === "selected" && pick.selected.id, SESSION);
  assert.deepEqual(pick.kind === "selected" && pick.sessions.map((s) => s.id), [SESSION, OLDER]);

  const older = pickHeelSlideSession(list, OLDER);
  assert.equal(older.kind === "selected" && older.selected.id, OLDER);

  assert.equal(pickHeelSlideSession(list, OTHER_EXERCISE).kind, "unavailable");
  assert.equal(pickHeelSlideSession(list, "55555555-5555-4555-8555-555555555555").kind, "unavailable");
  assert.equal(pickHeelSlideSession(list, "").kind, "selected");
  assert.deepEqual(pickHeelSlideSession([list[0]], undefined), { kind: "none" });
  assert.deepEqual(pickHeelSlideSession([], SESSION), { kind: "none" });
});

test("downsampling leaves short series alone", () => {
  const samples = [0, 1, 2].map((value, i) => ({ tMs: i, value }));
  const out = downsampleMinMax(samples, 10);
  assert.deepEqual(out, samples);
  assert.notEqual(out, samples);
  assert.throws(() => downsampleMinMax(samples, 1), RangeError);
});

test("downsampling stays within the cap, in time order, and keeps every extreme", () => {
  const samples = Array.from({ length: 10_007 }, (_, i) => ({ tMs: i * 20, value: 40 * Math.sin(i / 37) + (i % 13) }));
  samples[5_000] = { tMs: samples[5_000].tMs, value: 250 };
  samples[9_999] = { tMs: samples[9_999].tMs, value: -90 };
  const out = downsampleMinMax(samples, 1500);
  assert.ok(out.length <= 1500, `got ${out.length}`);
  assert.ok(out.length > 1400);
  for (let i = 1; i < out.length; i += 1) assert.ok(out[i].tMs > out[i - 1].tMs);
  assert.ok(out.some((s) => s.value === 250));
  assert.ok(out.some((s) => s.value === -90));
  assert.equal(out[0].tMs >= samples[0].tMs, true);
});

test("downsampling covers the whole series, up to the last bucket", () => {
  const samples = Array.from({ length: 3001 }, (_, i) => ({ tMs: i, value: i === 3000 ? 99 : 0 }));
  const out = downsampleMinMax(samples, 4);
  assert.ok(out.length <= 4);
  assert.equal(out[out.length - 1].value, 99);
});

test("ticks land on 1/2/5 steps and cover the range", () => {
  assert.deepEqual(niceTicks(0, 47, 5), [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(niceTicks(-12.5, 61, 5), [-20, 0, 20, 40, 60, 80]);
  assert.deepEqual(niceTicks(0, 0.7, 5), [0, 0.2, 0.4, 0.6, 0.8]);
  assert.deepEqual(niceTicks(5, 5, 2), [4, 5, 6]);
  assert.deepEqual(niceTicks(Number.NaN, 5), []);
  assert.ok(niceTicks(-3, 3, 3).every((tick) => !Object.is(tick, -0)));
});

test("delivered rate comes from stored timestamps", () => {
  const points = Array.from({ length: 51 }, (_, i) => [1_000 + i * 20, 0] as const);
  assert.equal(deliveredHz(points), 50);
  assert.equal(deliveredHz([...points].reverse()), 50);
  assert.equal(deliveredHz([[5, 1]]), null);
  assert.equal(deliveredHz([[5, 1], [5, 2]]), null);
  assert.equal(deliveredHz([]), null);
});

test("rate readbacks are read in every shape the sensors step may store, and nothing else", () => {
  assert.deepEqual(parseRateReadout({ requestedHz: 50, confirmed: true, readbackCode: 8 }), { status: "confirmed", requestedHz: 50 });
  assert.deepEqual(parseRateReadout({ requested_hz: 50, confirmed: false, readback_code: 6, failure: "mismatch" }), {
    status: "unconfirmed",
    requestedHz: 50,
    failure: "mismatch",
    readbackCode: 6,
  });
  assert.deepEqual(parseRateReadout({ status: "done", result: { requestedHz: 50, confirmed: false, readbackCode: null, failure: "no_reply" } }), {
    status: "unconfirmed",
    requestedHz: 50,
    failure: "no_reply",
    readbackCode: null,
  });
  assert.deepEqual(parseRateReadout({ status: "configuring", requestedHz: 50 }), { status: "pending", requestedHz: 50 });
  assert.deepEqual(parseRateReadout({ status: "idle" }), { status: "unknown" });
  assert.deepEqual(parseRateReadout(null), { status: "unknown" });
  assert.deepEqual(parseRateReadout("50"), { status: "unknown" });
});

test("numbers and codes format for display", () => {
  assert.equal(formatDecimal(49.84, "en"), "49.8");
  assert.equal(formatDecimal(49.84, "ru"), "49,8");
  assert.equal(formatDecimal(49.84, "kk"), "49,8");
  assert.equal(formatDecimal(12, "en", 0), "12");
  assert.equal(hexCode(8), "0x08");
  assert.equal(hexCode(0x0b), "0x0B");
});

test("check-in answers are read as stored; unknown values stay unknown", () => {
  assert.deepEqual(parseCheckIn({ pain_before: 0, pain_after: 11, difficulty: "3", knee_feels: "worse", symptoms: [], language: "de" }), {
    painBefore: 0,
    painAfter: null,
    difficulty: null,
    kneeFeels: null,
    symptoms: [],
    otherNote: null,
    language: null,
    submittedAt: null,
  });
  assert.equal(parseCheckIn(null), null);
});

test("the view recounts reps from stored frames across the seam, apart from the device count", () => {
  const view = buildHeelSlideView(resultPayload(), MOTION, { expectedPatientId: PATIENT });
  assert.ok(view);
  assert.equal(view.recount.count, 10);
  assert.equal(view.recount.reason, null);
  assert.deepEqual(view.recount.thresholds, { enterDeg: 22.5, exitDeg: 7, minRepMs: 250 });
  assert.equal(view.deviceCount, 9);
  assert.equal(view.targetReps, 10);
  assert.equal(view.chart.segments.length, 10);
  for (const segment of view.chart.segments) assert.ok(segment.endMs > segment.startMs);
  assert.equal(view.exerciseName, "Heel Slide");
  assert.equal(view.patientName, "test.patient");
  assert.equal(view.session.durationMs, 72_000);
  assert.equal(view.session.status, "completed");
  assert.equal(view.pendingAtFinish, 0);
});

test("the chart is capped, and its peaks survive the cap", () => {
  const view = buildHeelSlideView(resultPayload(), MOTION);
  assert.ok(view);
  assert.ok(view.chart.totalPoints > 1500, `series has ${view.chart.totalPoints} samples`);
  assert.ok(view.chart.points.length <= 1500);
  const drawnPeak = Math.max(...view.chart.points.map((p) => p.value));
  assert.ok(drawnPeak > 59 && drawnPeak <= 60.5, `peak ${drawnPeak}`);
  assert.equal(view.chart.startMs, view.chart.points[0].tMs);
});

test("the technical block reports stored counts, rates and pairing as recorded", () => {
  const payload = resultPayload();
  const view = buildHeelSlideView(payload, MOTION);
  assert.ok(view);
  const [thigh, shank, foot] = view.roles;
  assert.equal(thigh.role, "thigh");
  assert.equal(thigh.storedFrames, payload.frames.thigh.length);
  assert.equal(shank.storedFrames, payload.frames.shank.length + 2);
  assert.ok(thigh.deliveredHz !== null && Math.abs(thigh.deliveredHz - 50) < 1e-6);
  assert.equal(foot.deliveredHz, null);
  assert.equal(thigh.deviceName, "WT901-A");
  assert.deepEqual(thigh.rate, { status: "confirmed", requestedHz: 50 });
  assert.deepEqual(shank.rate, { status: "unconfirmed", requestedHz: 50, failure: "mismatch", readbackCode: 6 });
  assert.deepEqual(foot.rate, { status: "unknown" });
  assert.equal(view.pairing.medianSkewMs, 6);
  assert.equal(view.pairing.maxSkewMs, 6);
  assert.equal(view.pairing.unpairedShank, 0);
  assert.deepEqual(view.checkIn?.symptoms, ["redness", "other"]);
  assert.equal(view.checkIn?.otherNote, "stiff in the morning");
  assert.equal(view.checkIn?.kneeFeels, "same");
});

test("a session with too few frames is not countable rather than zero", () => {
  const view = buildHeelSlideView(resultPayload({ frames: { thigh: [], shank: [], foot_count: 0 }, check_in: null }), MOTION);
  assert.ok(view);
  assert.equal(view.recount.count, null);
  assert.equal(view.recount.reason, "insufficient_samples");
  assert.equal(view.chart.points.length, 0);
  assert.equal(view.chart.startMs, null);
  assert.equal(view.roles[0].deliveredHz, null);
  assert.equal(view.pairing.medianSkewMs, null);
  assert.equal(view.checkIn, null);
});

test("missing dose and summary stay unknown; the default dose is the fallback target", () => {
  const payload = resultPayload({ prescription: null });
  const session = { ...payload.session, summary: null, device_info: null, ended_at: null };
  const view = buildHeelSlideView({ ...payload, session }, MOTION);
  assert.ok(view);
  assert.equal(view.targetReps, 12);
  assert.equal(view.deviceCount, null);
  assert.equal(view.pendingAtFinish, null);
  assert.equal(view.session.durationMs, null);
  assert.deepEqual(view.roles.map((r) => r.rate.status), ["unknown", "unknown", "unknown"]);
});

test("a payload that is not this patient's session result gives no view", () => {
  assert.equal(buildHeelSlideView(null, MOTION), null);
  assert.equal(buildHeelSlideView({ session: { id: "x" } }, MOTION), null);
  assert.equal(buildHeelSlideView(resultPayload(), MOTION, { expectedPatientId: OLDER }), null);
});
