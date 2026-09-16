import assert from "node:assert/strict";
import { test } from "node:test";

import { buildStoredProxySeries, DEFAULT_MAX_PAIR_SKEW_MS } from "../motion/flexion.ts";
import { countOrientedRepetitions, heelSlideThresholds, MAX_REP_GAP_MS } from "../motion/reps.ts";
import {
  buildHeelSlideView,
  clockDuration,
  deliveredHz,
  deviceCountNote,
  downsampleMinMax,
  formatDecimal,
  hexCode,
  isSimulatedSession,
  isUuid,
  type MotionDeps,
  nearestOffsetStats,
  niceTicks,
  parseBaselineWindow,
  parseBaselineWindows,
  parseBattery,
  parseCheckIn,
  parseRateHistory,
  parseRateReadout,
  parseSessionList,
  pickHeelSlideSession,
  type ReviewSessionItem,
  sessionListOutcome,
} from "./heelSlideView.ts";

const MOTION: MotionDeps = {
  buildStoredProxySeries,
  countOrientedRepetitions,
  heelSlideThresholds,
  maxRepGapMs: MAX_REP_GAP_MS,
  maxPairSkewMs: DEFAULT_MAX_PAIR_SKEW_MS,
};

const PATIENT = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const OLDER = "33333333-3333-4333-8333-333333333333";
const OTHER_EXERCISE = "44444444-4444-4444-8444-444444444444";

const T0 = Date.parse("2026-09-15T08:00:00Z");
const STARTED_AT = "2026-09-15T07:59:30Z";

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
 * A stored session at `hz`: the leg rests, then `reps` slow heel slides of `peakDeg` of relative orientation, each
 * followed by a rest. The thigh sits near +175 degrees of pitch, so the shank crosses the +/-180 seam on every
 * bend. The shank sensor notifies `skewMs` after the thigh. `offsetDeg` shifts the shank's rest pose (a strap that
 * moved), and no frames are stored inside `gapsMs` ([from, to) ms after `t0`, both sensors silent).
 */
function storedSession({
  hz = 50,
  reps = 10,
  peakDeg = 60,
  restS = 1.5,
  repS = 2,
  skewMs = 6,
  t0 = T0,
  offsetDeg = 0,
  gapsMs = [] as [number, number][],
} = {}) {
  const thigh: [number, number][] = [];
  const shank: [number, number][] = [];
  const cycleS = repS + restS;
  const totalS = restS + reps * cycleS;
  const n = Math.round(totalS * hz);
  for (let i = 0; i < n; i += 1) {
    const tS = i / hz;
    const relMs = i * (1000 / hz);
    if (gapsMs.some(([from, to]) => relMs >= from && relMs < to)) continue;
    const inCycle = tS - restS;
    let bend = 0;
    if (inCycle >= 0) {
      const phase = inCycle % cycleS;
      if (phase < repS) bend = peakDeg * Math.sin((Math.PI * phase) / repS);
    }
    const thighPitch = 175 + 0.3 * Math.sin(i * 0.7);
    const shankRaw = thighPitch + offsetDeg + bend;
    const shankPitch = shankRaw > 180 ? shankRaw - 360 : shankRaw;
    const tMs = t0 + relMs;
    thigh.push([tMs, thighPitch]);
    shank.push([tMs + skewMs, shankPitch]);
  }
  return { thigh, shank };
}

function resultPayload(overrides: Record<string, unknown> = {}, summaryOverrides: Record<string, unknown> = {}) {
  const { thigh, shank } = storedSession();
  return {
    session: {
      id: SESSION,
      patient_id: PATIENT,
      status: "completed",
      started_at: STARTED_AT,
      ended_at: "2026-09-15T08:00:42Z",
      device_info: {
        transport: "web-bluetooth",
        roles: {
          thigh: { device_id: "a", device_name: "WT901-A", rate: { requestedHz: 50, confirmed: true } },
          shank: { device_id: "b", device_name: "WT901-B", rate: { requestedHz: 50, confirmed: false, readbackCode: 6, failure: "mismatch" } },
          foot: { device_id: "c", device_name: "WT901-C", rate: null },
        },
      },
      summary: { kind: "heel_slide_path.v1", reps_counted_on_device: 9, telemetry: { pending_at_finish: 0 }, ...summaryOverrides },
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

test("a failed session-list call is an error, never 'no sessions'; null data is a refusal", () => {
  assert.deepEqual(sessionListOutcome({ data: null, error: { code: "PGRST202", message: "not found" } }), { kind: "error" });
  assert.deepEqual(sessionListOutcome({ data: [], error: new Error("fetch failed") }), { kind: "error" });
  assert.deepEqual(sessionListOutcome({ data: null, error: null }), { kind: "not_allowed" });
  assert.deepEqual(sessionListOutcome({ data: [], error: null }), { kind: "ok", sessions: [] });
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

test("rate history entries keep their order and time, with the sensor's requested rate", () => {
  assert.equal(parseRateHistory(undefined, 50), null);
  assert.deepEqual(
    parseRateHistory(
      [
        { at_ms: 1_000, confirmed: false, readback_code: null, failure: "no_reply" },
        "junk",
        { at_ms: 2_000, confirmed: true, readback_code: 9, failure: null },
        { confirmed: "yes" },
      ],
      100,
    ),
    [
      { atMs: 1_000, readout: { status: "unconfirmed", requestedHz: 100, failure: "no_reply", readbackCode: null } },
      { atMs: 2_000, readout: { status: "confirmed", requestedHz: 100 } },
      { atMs: null, readout: { status: "unknown" } },
    ],
  );
});

test("battery readings are read as stored; a failed or implausible read stays unknown", () => {
  assert.deepEqual(parseBattery({ volts: 3.92, vendor_percent: 75 }), { volts: 3.92, vendorPercent: 75 });
  assert.deepEqual(parseBattery({ volts: 7.9, vendorPercent: 140 }), { volts: 7.9, vendorPercent: null });
  assert.equal(parseBattery({ volts: 0, vendor_percent: 0 }), null);
  assert.equal(parseBattery({ volts: 42, vendor_percent: 100 }), null);
  assert.equal(parseBattery({ vendor_percent: 50 }), null);
  assert.equal(parseBattery(null), null);
});

test("the saved zero windows are read only when both bounds are numbers", () => {
  assert.deepEqual(parseBaselineWindow({ start: 10, end: 510 }), { startMs: 10, endMs: 510 });
  assert.equal(parseBaselineWindow({ start: "10", end: 510 }), null);
  assert.equal(parseBaselineWindow(undefined), null);
  assert.deepEqual(parseBaselineWindows([{ start: 10, end: 510 }, { start: "x", end: 1 }, null, { start: 900, end: 1400 }]), [
    { startMs: 10, endMs: 510 },
    { startMs: 900, endMs: 1400 },
  ]);
  assert.deepEqual(parseBaselineWindows([]), []);
  assert.equal(parseBaselineWindows(undefined), null);
  assert.equal(parseBaselineWindows({ start: 10, end: 510 }), null);
});

test("skew between sensors measures every shank frame against its nearest thigh frame, with no cap", () => {
  const thigh = [0, 20, 40, 60, 1_000].map((tMs) => [tMs, 0] as const);
  const shank = [6, 26, 46, 400, 1_003].map((tMs) => [tMs, null] as const);
  // 6, 6, 6, 340 (400 is 340 from 60 and 600 from 1000), 3: the 340 is exactly what pairing would leave out.
  assert.deepEqual(nearestOffsetStats(thigh, shank), { frames: 5, medianMs: 6, p95Ms: 340, maxMs: 340 });
  assert.deepEqual(nearestOffsetStats(thigh, [[10, 1], [50, 1]]), { frames: 2, medianMs: 10, p95Ms: 10, maxMs: 10 });
  assert.equal(nearestOffsetStats([], shank), null);
  assert.equal(nearestOffsetStats(thigh, []), null);
});

test("numbers, codes and durations format for display", () => {
  assert.equal(formatDecimal(49.84, "en"), "49.8");
  assert.equal(formatDecimal(49.84, "ru"), "49,8");
  assert.equal(formatDecimal(49.84, "kk"), "49,8");
  assert.equal(formatDecimal(12, "en", 0), "12");
  assert.equal(hexCode(8), "0x08");
  assert.equal(hexCode(0x0b), "0x0B");
  assert.equal(clockDuration(65_000), "1:05");
  assert.equal(clockDuration(-45_400), "0:45");
  assert.equal(clockDuration(0), "0:00");
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
  assert.equal(view.recount.cancelled, 0);
  assert.equal(view.recount.maxGapMs, MAX_REP_GAP_MS);
  assert.deepEqual(view.recount.baseline, { source: "first_samples", zeroFound: true, pairsBeforeWindow: 0 });
  assert.deepEqual(view.recount.starts, []);
  assert.deepEqual(view.recount.thresholds, { enterDeg: 22.5, exitDeg: 7, minRepMs: 250 });
  assert.equal(view.deviceCount, 9);
  assert.equal(deviceCountNote(view), "differs");
  assert.equal(view.targetReps, 10);
  assert.equal(view.chart.segments.length, 10);
  for (const segment of view.chart.segments) assert.ok(segment.endMs > segment.startMs);
  assert.equal(view.exerciseName, "Heel Slide");
  assert.equal(view.patientName, "test.patient");
  assert.equal(view.session.durationMs, 72_000);
  assert.equal(view.session.status, "completed");
  assert.equal(view.telemetry.pendingAtFinish, 0);
  assert.equal(view.restartedAfterReload, null);
});

test("the chart is capped, and its peaks survive the cap", () => {
  const view = buildHeelSlideView(resultPayload(), MOTION);
  assert.ok(view);
  assert.ok(view.chart.totalPoints > 1500, `series has ${view.chart.totalPoints} samples`);
  assert.equal(view.chart.counted.length, 1);
  assert.ok(view.chart.counted[0].length <= 1500);
  assert.deepEqual(view.chart.uncounted, []);
  assert.equal(view.chart.beforeStart, false);
  assert.equal(view.chart.ownZero, false);
  assert.deepEqual(view.chart.startMarksMs, []);
  const drawnPeak = Math.max(...view.chart.counted[0].map((p) => p.value));
  assert.ok(drawnPeak > 59 && drawnPeak <= 60.5, `peak ${drawnPeak}`);
  assert.equal(view.chart.startMs, view.chart.counted[0][0].tMs);
});

test("without a finish record, the technical block reports stored counts and the start record, marked as such", () => {
  const payload = resultPayload();
  const view = buildHeelSlideView(payload, MOTION);
  assert.ok(view);
  const [thigh, shank, foot] = view.roles;
  assert.equal(thigh.role, "thigh");
  assert.equal(thigh.storedFrames, payload.frames.thigh.length);
  assert.equal(shank.storedFrames, payload.frames.shank.length + 2);
  assert.ok(thigh.deliveredHz !== null && Math.abs(thigh.deliveredHz - 50) < 1e-6);
  assert.equal(foot.deliveredHz, null);
  assert.deepEqual(thigh.device, { name: "WT901-A", idShort: "a" });
  assert.equal(thigh.deviceSource, "start");
  assert.equal(thigh.deviceAtStartIfChanged, null);
  assert.deepEqual(thigh.rate, { status: "confirmed", requestedHz: 50 });
  assert.equal(thigh.rateSource, "start");
  assert.equal(thigh.rateChecks, null);
  assert.equal(thigh.requestedHz, 50);
  assert.deepEqual(shank.rate, { status: "unconfirmed", requestedHz: 50, failure: "mismatch", readbackCode: 6 });
  assert.deepEqual(foot.rate, { status: "unknown" });
  assert.equal(foot.requestedHz, null);
  assert.equal(thigh.batteryStart, null);
  assert.equal(thigh.batteryEnd, null);
  assert.equal(thigh.reconnects, null);
  assert.equal(view.pairing.medianSkewMs, 6);
  assert.equal(view.pairing.maxSkewMs, 6);
  assert.equal(view.pairing.unpairedShank, 0);
  assert.equal(view.pairingToleranceMs, 100);
  assert.deepEqual(view.interSensorSkew.thighShank, { frames: payload.frames.shank.length, medianMs: 6, p95Ms: 6, maxMs: 6 });
  assert.deepEqual(view.checkIn?.symptoms, ["redness", "other"]);
  assert.equal(view.checkIn?.otherNote, "stiff in the morning");
  assert.equal(view.checkIn?.kneeFeels, "same");
});

test("the finish record wins for device, rate and battery, and a swapped device is flagged", () => {
  const startMs = Date.parse(STARTED_AT);
  const payload = resultPayload();
  payload.session.device_info.roles.thigh = {
    device_id: "WebBluetoothId-aa1111",
    device_name: "WT901-A",
    rate: { requestedHz: 50, confirmed: true },
    battery: { volts: 4.01, vendor_percent: 100 },
  } as never;
  payload.session.device_info.roles.shank = {
    device_id: "WebBluetoothId-bb2222",
    device_name: "WT901-B",
    rate: { status: "configuring", requestedHz: 50 },
    battery: { volts: 3.7, vendor_percent: 15 },
  } as never;
  payload.session.device_info.roles.foot = {
    device_id: "WebBluetoothId-cc3333",
    device_name: "WT901-C",
    rate: null,
    battery: null,
  } as never;
  (payload.session.summary as Record<string, unknown>).sensors = {
    thigh: {
      device_name: "WT901-A2",
      device_id_short: "zz9999",
      requested_hz: 100,
      rate_history: [
        { at_ms: startMs - 45_000, confirmed: false, readback_code: null, failure: "no_reply" },
        { at_ms: startMs + 12_000, confirmed: true, readback_code: 9, failure: null },
      ],
      delivered_hz: 99.1,
      battery_start: { volts: 3.92, vendor_percent: 75 },
      battery_end: { volts: 3.85, vendor_percent: 57.2 },
      reconnects: 1,
    },
    foot: {
      device_name: "WT901-C",
      device_id_short: "cc3333",
      requested_hz: 50,
      rate_history: [],
      battery_start: { volts: 0, vendor_percent: 0 },
      battery_end: "unknown",
      reconnects: 0,
    },
  };

  const view = buildHeelSlideView(payload, MOTION);
  assert.ok(view);
  const [thigh, shank, foot] = view.roles;

  assert.deepEqual(thigh.device, { name: "WT901-A2", idShort: "zz9999" });
  assert.equal(thigh.deviceSource, "finish");
  assert.deepEqual(thigh.deviceAtStartIfChanged, { name: "WT901-A", idShort: "aa1111" });
  assert.equal(thigh.requestedHz, 100);
  assert.deepEqual(thigh.rate, { status: "confirmed", requestedHz: 100 });
  assert.equal(thigh.rateSource, "finish");
  assert.deepEqual(
    thigh.rateChecks?.map((check) => [check.atMs, check.readout.status]),
    [
      [startMs - 45_000, "unconfirmed"],
      [startMs + 12_000, "confirmed"],
    ],
  );
  assert.deepEqual(thigh.batteryStart, { volts: 3.92, vendorPercent: 75 });
  assert.deepEqual(thigh.batteryEnd, { volts: 3.85, vendorPercent: 57.2 });
  assert.equal(thigh.reconnects, 1);

  // No finish record for the shank: everything comes from the start, including a setup still running then.
  assert.deepEqual(shank.device, { name: "WT901-B", idShort: "bb2222" });
  assert.equal(shank.deviceSource, "start");
  assert.deepEqual(shank.rate, { status: "pending", requestedHz: 50 });
  assert.equal(shank.rateSource, "start");
  assert.deepEqual(shank.batteryStart, { volts: 3.7, vendorPercent: 15 });
  assert.equal(shank.batteryEnd, null);
  assert.equal(shank.reconnects, null);

  // Same unit at start and finish, an empty history, and battery reads that failed.
  assert.equal(foot.deviceAtStartIfChanged, null);
  assert.deepEqual(foot.rateChecks, []);
  assert.equal(foot.rateSource, "start");
  assert.equal(foot.batteryStart, null);
  assert.equal(foot.batteryEnd, null);
  assert.equal(foot.reconnects, 0);
});

test("telemetry counts are the device's; a summary without frames_confirmed is unknown, not zero", () => {
  const confirmed = buildHeelSlideView(
    resultPayload({}, { telemetry: { frames_confirmed: 1_200, pending_at_finish: 3, errors: 1, dropped: 0 } }),
    MOTION,
  );
  assert.deepEqual(confirmed?.telemetry, { framesConfirmed: 1_200, pendingAtFinish: 3, errors: 1, dropped: 0 });

  const older = buildHeelSlideView(resultPayload({}, { telemetry: { frames_sent: 50, pending_at_finish: null } }), MOTION);
  assert.deepEqual(older?.telemetry, { framesConfirmed: null, pendingAtFinish: null, errors: null, dropped: null });
});

test("the recount zeroes on the saved window, so an abandoned start before it is drawn but not counted", () => {
  // A start abandoned after 0.3 s at one rest pose, then the strap shifts 12 degrees and ten reps follow.
  const abandoned = storedSession({ reps: 0, restS: 0.3 });
  const started = storedSession({ t0: T0 + 5_000, offsetDeg: 12 });
  const frames = {
    thigh: [...abandoned.thigh, ...started.thigh],
    shank: [...abandoned.shank, ...started.shank],
    foot_count: 0,
  };
  const window = { start: T0 + 5_000, end: T0 + 5_500 };

  const withWindow = buildHeelSlideView(
    resultPayload({ frames }, { reps_counted_on_device: 10, baseline_window_ms: window, restarted_after_reload: true }),
    MOTION,
  );
  assert.ok(withWindow);
  assert.equal(withWindow.recount.count, 10);
  assert.deepEqual(withWindow.recount.baseline, {
    source: "window",
    zeroFound: true,
    pairsBeforeWindow: abandoned.shank.length,
  });
  assert.deepEqual(withWindow.recount.starts, [
    { number: 1, windowStartMs: T0 + 5_000, zeroFound: true, count: 10, pairs: started.shank.length },
  ]);
  assert.equal(withWindow.restartedAfterReload, true);
  assert.equal(deviceCountNote(withWindow), "same");
  // Drawn, within the shared cap (the pre-start line gets its share of the points), from the first stored pair.
  assert.equal(withWindow.chart.beforeStart, true);
  assert.equal(withWindow.chart.ownZero, false);
  assert.equal(withWindow.chart.uncounted.length, 1);
  const beforeLine = withWindow.chart.uncounted[0];
  assert.ok(beforeLine.length > 0 && beforeLine.length <= abandoned.shank.length);
  assert.ok(beforeLine.every((sample) => sample.tMs < window.start));
  assert.equal(withWindow.chart.startMs, T0 + 6);
  assert.equal(withWindow.chart.totalPoints, withWindow.pairing.pairs);
  // The abandoned pose reads about 12 degrees below the zero it is drawn on.
  const abandonedLevel = beforeLine[0].value;
  assert.ok(Math.abs(Math.abs(abandonedLevel) - 12) < 1.5, `abandoned start drawn at ${abandonedLevel}`);

  // Without the window the zero is the abandoned pose, and the shifted rest never falls back below the exit.
  const withoutWindow = buildHeelSlideView(resultPayload({ frames }, { reps_counted_on_device: 10 }), MOTION);
  assert.ok(withoutWindow);
  assert.equal(withoutWindow.recount.baseline.source, "first_samples");
  assert.notEqual(withoutWindow.recount.count, 10);
});

test("a saved window with no stored pair inside it gives no zero and no count, rather than another zero", () => {
  const view = buildHeelSlideView(
    resultPayload({}, { baseline_window_ms: { start: T0 + 3_600_000, end: T0 + 3_600_500 } }),
    MOTION,
  );
  assert.ok(view);
  assert.equal(view.recount.count, null);
  assert.equal(view.recount.reason, "insufficient_samples");
  assert.ok(view.pairing.pairs > 0);
  assert.deepEqual(view.recount.baseline, { source: "window", zeroFound: false, pairsBeforeWindow: view.pairing.pairs });
  // Every stored pair is still drawn, grey, on its own first half second.
  assert.deepEqual(view.chart.counted, []);
  assert.equal(view.chart.uncounted.length, 1);
  assert.equal(view.chart.totalPoints, view.pairing.pairs);
  assert.equal(view.chart.beforeStart, true);
  assert.equal(view.chart.ownZero, true);
});

test("when the zero window's frames were lost but later frames landed, the stored series is drawn, not hidden", () => {
  // The device dropped the oldest rows, the zero window among them; everything after it was stored.
  const zeroWindow = { start: T0 - 10_000, end: T0 - 9_500 };
  const view = buildHeelSlideView(resultPayload({}, { baseline_window_ms: zeroWindow }), MOTION);
  assert.ok(view);
  assert.equal(view.recount.count, null);
  assert.deepEqual(view.recount.baseline, { source: "window", zeroFound: false, pairsBeforeWindow: 0 });
  assert.deepEqual(view.recount.starts, [
    { number: 1, windowStartMs: T0 - 10_000, zeroFound: false, count: null, pairs: view.pairing.pairs },
  ]);
  assert.deepEqual(view.chart.counted, []);
  assert.equal(view.chart.uncounted.length, 1);
  assert.ok(view.chart.uncounted[0].length > 2);
  assert.equal(view.chart.totalPoints, view.pairing.pairs);
  assert.equal(view.chart.beforeStart, false);
  assert.equal(view.chart.ownZero, true);
  assert.equal(view.chart.startMs, T0 + 6);
  const drawnPeak = Math.max(...view.chart.uncounted[0].map((p) => p.value));
  assert.ok(drawnPeak > 55, `peak ${drawnPeak}`);

  // A later start with its own lost window does not take the earlier start's count away.
  const twoStarts = buildHeelSlideView(
    resultPayload({}, {
      reps_counted_on_device: 0,
      baseline_windows_ms: [
        { start: T0, end: T0 + 500 },
        { start: T0 + 3_600_000, end: T0 + 3_600_500 },
      ],
    }),
    MOTION,
  );
  assert.ok(twoStarts);
  assert.equal(twoStarts.recount.count, 10);
  assert.deepEqual(
    twoStarts.recount.starts.map((start) => [start.zeroFound, start.count, start.pairs]),
    [
      [true, 10, twoStarts.pairing.pairs],
      [false, null, 0],
    ],
  );
  assert.equal(deviceCountNote(twoStarts), "last_start_only");
});

test("a rep open when the data paused for more than the gap is not recounted", () => {
  // Rep 4 runs from 12 s to 14 s after the start; both sensors fall silent from 12.5 s to 14.7 s.
  const paused = storedSession({ gapsMs: [[12_500, 14_700]] });
  const view = buildHeelSlideView(
    resultPayload({ frames: { thigh: paused.thigh, shank: paused.shank, foot_count: 0 } }),
    MOTION,
  );
  assert.ok(view);
  assert.equal(view.recount.count, 9);
  assert.equal(view.recount.cancelled, 1);
  // The pause is a gap in both sensors, so pairing never sees it; the skew between sensors stays small too.
  assert.ok((view.pairing.maxSkewMs ?? Infinity) <= 100);
  for (const segment of view.chart.segments) {
    assert.ok(segment.endMs <= T0 + 12_500 || segment.startMs >= T0 + 14_700, "no counted rep spans the pause");
  }
});

test("every saved start is recounted on its own zero and the counts are added: 2 before a reload and 10 after is 12", () => {
  // Two slides, a reload, the strap settled 12 degrees differently, then ten slides. Each start saved its window.
  const before = storedSession({ reps: 2 });
  const after = storedSession({ t0: T0 + 60_000, offsetDeg: 12 });
  const frames = { thigh: [...before.thigh, ...after.thigh], shank: [...before.shank, ...after.shank], foot_count: 0 };
  const windows = [
    { start: T0, end: T0 + 500 },
    { start: T0 + 60_000, end: T0 + 60_500 },
  ];
  const summary = { reps_counted_on_device: 10, baseline_window_ms: windows[1], restarted_after_reload: true };

  const view = buildHeelSlideView(resultPayload({ frames }, { ...summary, baseline_windows_ms: windows }), MOTION);
  assert.ok(view);
  assert.equal(view.recount.count, 12);
  assert.equal(view.recount.reason, null);
  assert.deepEqual(view.recount.starts, [
    { number: 1, windowStartMs: T0, zeroFound: true, count: 2, pairs: before.shank.length },
    { number: 2, windowStartMs: T0 + 60_000, zeroFound: true, count: 10, pairs: after.shank.length },
  ]);
  assert.deepEqual(view.recount.baseline, { source: "window", zeroFound: true, pairsBeforeWindow: 0 });
  assert.equal(view.chart.segments.length, 12);
  assert.equal(view.chart.counted.length, 2);
  assert.deepEqual(view.chart.uncounted, []);
  assert.deepEqual(view.chart.startMarksMs, [T0, T0 + 60_000]);
  // The device's 10 covers only the last start: never "matches", even though it equals that start's recount.
  assert.equal(deviceCountNote(view), "last_start_only");

  // A summary from before the list existed has only the latest window: that start is recounted, the rest drawn.
  const latestOnly = buildHeelSlideView(resultPayload({ frames }, summary), MOTION);
  assert.ok(latestOnly);
  assert.equal(latestOnly.recount.count, 10);
  assert.equal(latestOnly.recount.starts.length, 1);
  assert.equal(latestOnly.recount.baseline.pairsBeforeWindow, before.shank.length);
  assert.equal(deviceCountNote(latestOnly), "same");
});

test("all chart lines together stay within the cap", () => {
  const abandoned = storedSession({ reps: 2 });
  const started = storedSession({ t0: T0 + 60_000 });
  const frames = { thigh: [...abandoned.thigh, ...started.thigh], shank: [...abandoned.shank, ...started.shank], foot_count: 0 };
  const drawn = (lines: { length: number }[]) => lines.reduce((sum, line) => sum + line.length, 0);

  const oneStart = buildHeelSlideView(
    resultPayload({ frames }, { baseline_window_ms: { start: T0 + 60_000, end: T0 + 60_500 } }),
    MOTION,
    { maxChartPoints: 300 },
  );
  assert.ok(oneStart);
  assert.ok(oneStart.chart.uncounted[0].length >= 2);
  assert.ok(drawn(oneStart.chart.counted) + drawn(oneStart.chart.uncounted) <= 300);
  assert.equal(oneStart.chart.totalPoints, abandoned.shank.length + started.shank.length);
  assert.equal(oneStart.recount.count, 10);

  const threeLines = buildHeelSlideView(
    resultPayload(
      { frames },
      {
        baseline_windows_ms: [
          { start: T0 + 1_000, end: T0 + 1_500 },
          { start: T0 + 60_000, end: T0 + 60_500 },
        ],
      },
    ),
    MOTION,
    { maxChartPoints: 300 },
  );
  assert.ok(threeLines);
  assert.equal(threeLines.chart.counted.length, 2);
  assert.equal(threeLines.chart.uncounted.length, 1);
  assert.ok(drawn(threeLines.chart.counted) + drawn(threeLines.chart.uncounted) <= 300);
  assert.ok([...threeLines.chart.counted, ...threeLines.chart.uncounted].every((line) => line.length >= 2));
});

test("frames that reach one sensor late show in the skew between sensors, not in the pairing skew", () => {
  // The thigh's frames from 10.0 s to 10.6 s never arrived; the shank kept sending.
  const payload = resultPayload();
  const frames = payload.frames;
  const thigh = frames.thigh.filter(([tMs]) => tMs < T0 + 10_000 || tMs >= T0 + 10_600);
  const view = buildHeelSlideView(resultPayload({ frames: { ...frames, thigh } }), MOTION);
  assert.ok(view);
  assert.ok(view.pairing.unpairedShank > 0);
  assert.ok((view.pairing.maxSkewMs ?? Infinity) <= view.pairingToleranceMs);
  const skew = view.interSensorSkew.thighShank;
  assert.ok(skew);
  assert.ok(skew.maxMs > 250, `largest skew ${skew.maxMs}`);
  assert.equal(skew.medianMs, 6);
  assert.equal(skew.frames, frames.shank.length);
});

test("a session with too few frames is not countable rather than zero", () => {
  const view = buildHeelSlideView(resultPayload({ frames: { thigh: [], shank: [], foot_count: 0 }, check_in: null }), MOTION);
  assert.ok(view);
  assert.equal(view.recount.count, null);
  assert.equal(view.recount.reason, "insufficient_samples");
  assert.deepEqual(view.chart.counted, []);
  assert.deepEqual(view.chart.uncounted, []);
  assert.equal(view.chart.startMs, null);
  assert.equal(view.roles[0].deliveredHz, null);
  assert.equal(view.pairing.medianSkewMs, null);
  assert.equal(view.interSensorSkew.thighShank, null);
  assert.equal(view.checkIn, null);
});

test("missing dose and summary stay unknown; the default dose is the fallback target", () => {
  const payload = resultPayload({ prescription: null });
  const session = { ...payload.session, summary: null, device_info: null, ended_at: null };
  const view = buildHeelSlideView({ ...payload, session }, MOTION);
  assert.ok(view);
  assert.equal(view.targetReps, 12);
  assert.equal(view.deviceCount, null);
  assert.equal(deviceCountNote(view), "missing");
  assert.deepEqual(view.telemetry, { framesConfirmed: null, pendingAtFinish: null, errors: null, dropped: null });
  assert.equal(view.session.durationMs, null);
  assert.deepEqual(view.roles.map((r) => r.rate.status), ["unknown", "unknown", "unknown"]);
  assert.deepEqual(view.roles.map((r) => r.deviceSource), [null, null, null]);
});

test("a session is simulated when the start record's transport or the finish record says so, and only then", () => {
  assert.equal(isSimulatedSession({ device_info: { transport: "simulated" }, summary: null }), true);
  assert.equal(isSimulatedSession({ device_info: null, summary: { simulated: true } }), true);
  assert.equal(isSimulatedSession({ device_info: { transport: "simulated" }, summary: { simulated: false } }), true);
  assert.equal(isSimulatedSession({ device_info: { transport: "web-bluetooth" }, summary: { simulated: true } }), true);
  assert.equal(isSimulatedSession({ device_info: { transport: "web-bluetooth" }, summary: { kind: "heel_slide_path.v1" } }), false);
  assert.equal(isSimulatedSession({ device_info: { transport: "Simulated" }, summary: { simulated: "true" } }), false);
  assert.equal(isSimulatedSession({ device_info: { roles: {} } }), false);
  assert.equal(isSimulatedSession({}), false);
  assert.equal(isSimulatedSession(null), false);
  assert.equal(isSimulatedSession("simulated"), false);

  assert.equal(buildHeelSlideView(resultPayload(), MOTION)?.session.simulated, false);
  assert.equal(buildHeelSlideView(resultPayload({}, { simulated: true }), MOTION)?.session.simulated, true);
  const payload = resultPayload();
  const started = { ...payload.session, device_info: { transport: "simulated", roles: {} }, summary: null, ended_at: null };
  assert.equal(buildHeelSlideView({ ...payload, session: started }, MOTION)?.session.simulated, true);
});

test("a payload that is not this patient's session result gives no view", () => {
  assert.equal(buildHeelSlideView(null, MOTION), null);
  assert.equal(buildHeelSlideView({ session: { id: "x" } }, MOTION), null);
  assert.equal(buildHeelSlideView(resultPayload(), MOTION, { expectedPatientId: OLDER }), null);
});
