import assert from "node:assert/strict";
import { test } from "node:test";

import { SENSOR_ROLES } from "../sensors/types.ts";
import { deliveredRates, parseSessionSummary, recordingComplete, ROLE_ORDER } from "./summary.ts";

// The shape below is the one buildHeelSlideSummary writes (components/flow/heelSlideRecords.ts), trimmed to the
// fields this parser reads. The numbers are those of the recorded walkthrough session.
const STORED = {
  kind: "heel_slide_path.v1",
  reps_counted_on_device: 11,
  target_reps: 10,
  rep_segments: [
    { start_ms: 4200, end_ms: 6100, peak_rel_deg: 41.2 },
    { start_ms: 8300, end_ms: 10100, peak_rel_deg: 44.8 },
  ],
  proxy: { definition: "wrap(shank.pitch - thigh.pitch)", calibrated: false, knee_flexion: false },
  thresholds: { enter_deg: 22.5, exit_deg: 7, min_rep_ms: 250, max_gap_ms: 1000 },
  restarted_after_reload: false,
  sensors: {
    thigh: {
      device_name: "WT901BLE68",
      requested_hz: 50,
      delivered_hz: 49.6,
      reconnects: 0,
      rate_history: [{ at_ms: 10, confirmed: true, readback_code: 8, failure: null }],
      battery_start: { volts: 3.98, vendor_percent: 90 },
      battery_end: { volts: 3.94, vendor_percent: 88 },
    },
    shank: { device_name: "WT901BLE68", delivered_hz: 50.1, reconnects: 1, rate_history: [] },
  },
  telemetry: { frames_confirmed: 20002, pending_at_finish: 0, errors: 0, dropped: 0 },
};

test("the local role order is the app's role order", () => {
  assert.deepEqual([...ROLE_ORDER], [...SENSOR_ROLES]);
});

test("a stored summary is read back field by field", () => {
  const facts = parseSessionSummary(STORED);
  assert.ok(facts);
  assert.equal(facts.repsCounted, 11);
  assert.equal(facts.targetReps, 10);
  assert.equal(facts.segments.length, 2);
  assert.equal(facts.movingSeconds, 3.7);
  assert.equal(facts.simulated, false);
  assert.equal(facts.restartedAfterReload, false);
  assert.deepEqual(facts.telemetry, { framesConfirmed: 20002, pendingAtFinish: 0, errors: 0, dropped: 0 });
});

test("sensors are read in body order, and what a sensor never answered stays null", () => {
  const facts = parseSessionSummary(STORED);
  assert.ok(facts);
  assert.deepEqual(
    facts.sensors.map((s) => s.role),
    ["thigh", "shank"],
    "the foot sensor is absent from the record, so it is absent here",
  );
  const [thigh, shank] = facts.sensors;
  assert.equal(thigh.deliveredHz, 49.6);
  assert.equal(thigh.rateConfirmed, true);
  assert.equal(thigh.batteryStartVolts, 3.98);
  assert.equal(shank.rateConfirmed, null, "no rate history means the sensor never confirmed anything");
  assert.equal(shank.requestedHz, null);
  assert.equal(shank.batteryStartVolts, null);
  assert.equal(shank.reconnects, 1);
  assert.deepEqual(deliveredRates(facts), [50, 50]);
});

test("a summary of another kind, or of no kind, is not half-read", () => {
  assert.equal(parseSessionSummary({ ...STORED, kind: "session-studio" }), null);
  assert.equal(parseSessionSummary({ reps_counted_on_device: 11 }), null);
  assert.equal(parseSessionSummary(null), null);
  assert.equal(parseSessionSummary("{}"), null);
  assert.equal(parseSessionSummary([]), null);
});

test("a session that stored almost nothing keeps its nulls", () => {
  const facts = parseSessionSummary({ kind: "heel_slide_path.v1" });
  assert.ok(facts);
  assert.equal(facts.repsCounted, null);
  assert.equal(facts.targetReps, null);
  assert.deepEqual(facts.segments, []);
  assert.equal(facts.movingSeconds, null);
  assert.deepEqual(facts.sensors, []);
  assert.deepEqual(facts.telemetry, {
    framesConfirmed: null,
    pendingAtFinish: null,
    errors: null,
    dropped: null,
  });
  assert.equal(recordingComplete(facts), null, "no counters is not the same as a clean recording");
});

test("nonsense segments are dropped rather than drawn", () => {
  const facts = parseSessionSummary({
    kind: "heel_slide_path.v1",
    rep_segments: [
      { start_ms: 100, end_ms: 50 },
      { start_ms: "a", end_ms: 200 },
      { start_ms: 900, end_ms: 1900 },
      null,
      { start_ms: 300, end_ms: 800 },
    ],
  });
  assert.ok(facts);
  assert.deepEqual(facts.segments, [
    { startMs: 300, endMs: 800 },
    { startMs: 900, endMs: 1900 },
  ]);
  assert.equal(facts.movingSeconds, 1.5);
});

test("the recording is complete only when nothing is waiting, dropped or failed", () => {
  const clean = parseSessionSummary(STORED);
  assert.ok(clean);
  assert.equal(recordingComplete(clean), true);

  const pending = parseSessionSummary({
    ...STORED,
    telemetry: { frames_confirmed: 900, pending_at_finish: 42, errors: 0, dropped: 0 },
  });
  assert.ok(pending);
  assert.equal(recordingComplete(pending), false);

  const dropped = parseSessionSummary({
    ...STORED,
    telemetry: { frames_confirmed: 900, pending_at_finish: 0, errors: 0, dropped: 3 },
  });
  assert.ok(dropped);
  assert.equal(recordingComplete(dropped), false);
});

test("a simulated session says so", () => {
  const facts = parseSessionSummary({ ...STORED, simulated: true });
  assert.ok(facts);
  assert.equal(facts.simulated, true);
});
