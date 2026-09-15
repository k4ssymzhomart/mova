import assert from "node:assert/strict";
import { test } from "node:test";

import type { LiveRoleState, RateHistoryEntry } from "@/lib/ble/liveSensors";
import type { SensorRole } from "@/lib/ble/roles";

import {
  type HeelSlideSummaryInput,
  batteryRecord,
  buildHeelSlideSummary,
  parseBatteryRecord,
  pendingAtFinish,
  pickStartBattery,
  rateRecord,
  requestedHzFromDeviceInfo,
  sensorDeviceInfo,
  startSensorsFromDeviceInfo,
} from "./heelSlideRecords.ts";

function roleState(role: SensorRole, overrides: Partial<LiveRoleState> = {}): LiveRoleState {
  return {
    role,
    link: "streaming",
    deviceId: `browser-device-id-${role}-ABC123`,
    deviceIdShort: "ABC123",
    deviceName: "WT901BLE68",
    requestedHz: 50,
    rate: { status: "idle" },
    rateHistory: [],
    deliveredHz: 49.5,
    framesReceived: 1500,
    framesTotal: 1500,
    framesLast30s: 1490,
    framesLast60s: null,
    connectedForMs: 31_000,
    lastSampleAt: 1_000_000,
    battery: { volts: 3.92, vendorPercent: 76.7, atMs: 999_000 },
    batteryError: null,
    reconnect: { state: "idle", attempts: 0, nextAttemptAtMs: null, succeeded: 0 },
    persistence: { status: "saved" },
    lastError: null,
    ...overrides,
  };
}

function roles(overrides: Partial<Record<SensorRole, Partial<LiveRoleState>>> = {}): Record<SensorRole, LiveRoleState> {
  return {
    thigh: roleState("thigh", overrides.thigh),
    shank: roleState("shank", overrides.shank),
    foot: roleState("foot", overrides.foot),
  };
}

const confirmed50: RateHistoryEntry = {
  requestedHz: 50,
  requestedCode: 0x08,
  readbackCode: 0x08,
  confirmed: true,
  attempts: 1,
  failure: null,
  errorMessage: null,
  finishedAt: 1000,
  atMs: 1000,
};

function summaryInput(overrides: Partial<HeelSlideSummaryInput> = {}): HeelSlideSummaryInput {
  const live = roles();
  return {
    repsCounted: 10,
    segments: Array.from({ length: 10 }, (_, i) => ({ startMs: 10_000 + i * 4000, endMs: 12_000 + i * 4000, peakValue: 61.26 })),
    targetReps: 10,
    proxyDefinition: "wrap(shank.pitch - thigh.pitch), baseline-zeroed, oriented",
    thresholds: { enterDeg: 22.5, exitDeg: 7, minRepMs: 250 },
    maxGapMs: 1000,
    baselineWindows: [{ start: 9000, end: 9500 }],
    restartedAfterReload: false,
    roles: live,
    startSensors: startSensorsFromDeviceInfo(sensorDeviceInfo({ roles: live })),
    firstSeenBattery: {},
    telemetry: { counters: { framesConfirmed: 9000, errors: 0, framesDropped: 0 }, pending: 0 },
    ...overrides,
  };
}

test("a rate record before the write names the rate the store will request", () => {
  assert.deepEqual(rateRecord({ status: "idle" }, 100), {
    status: "not_started",
    requested_hz: 100,
    requested_code: null,
    readback_code: null,
    confirmed: null,
    attempts: null,
    failure: null,
  });
  assert.equal(rateRecord({ status: "configuring", requestedHz: 50 }, 100).requested_hz, 50);
});

test("a finished rate record copies the readback", () => {
  const record = rateRecord({ status: "done", result: { ...confirmed50, readbackCode: 0x06, confirmed: false, failure: "mismatch" } });
  assert.deepEqual(record, {
    status: "done",
    requested_hz: 50,
    requested_code: 0x08,
    readback_code: 0x06,
    confirmed: false,
    attempts: 1,
    failure: "mismatch",
  });
});

test("a failed battery read is unknown, never the last reading", () => {
  const reading = { volts: 3.92, vendorPercent: 76.7, atMs: 1 };
  assert.deepEqual(batteryRecord(reading, null), { volts: 3.92, vendor_percent: 76.7 });
  assert.equal(batteryRecord(reading, "no_reply"), null);
  assert.equal(batteryRecord(null, null), null);
});

test("device_info records each role's device, rate, delivered rate and battery", () => {
  const info = sensorDeviceInfo({ roles: roles({ foot: { battery: null, deliveredHz: null, requestedHz: 100 } }) });
  assert.equal(info.transport, "web-bluetooth");
  assert.deepEqual(Object.keys(info.roles), ["thigh", "shank", "foot"]);
  assert.deepEqual(Object.keys(info.roles.thigh).sort(), ["battery", "delivered_hz", "device_id", "device_name", "rate"]);
  assert.deepEqual(info.roles.thigh.battery, { volts: 3.92, vendor_percent: 76.7 });
  assert.equal(info.roles.foot.battery, null);
  assert.equal(info.roles.foot.delivered_hz, null);
  assert.equal(info.roles.foot.rate.requested_hz, 100);
});

test("device_info reads back: start devices, batteries and the requested rate", () => {
  const info = sensorDeviceInfo({ roles: roles({ shank: { requestedHz: 100, batteryError: "implausible_value" } }) });
  const start = startSensorsFromDeviceInfo(JSON.parse(JSON.stringify(info)));
  assert.equal(start.thigh.deviceId, "browser-device-id-thigh-ABC123");
  assert.deepEqual(start.thigh.battery, { volts: 3.92, vendor_percent: 76.7 });
  assert.equal(start.shank.battery, null);
  assert.equal(requestedHzFromDeviceInfo(info), 50);
  assert.equal(requestedHzFromDeviceInfo({ roles: { thigh: { rate: { requested_hz: 100 } } } }), 100);
});

test("malformed device_info reads back as unknown", () => {
  for (const value of [null, "x", [], {}, { roles: [] }, { roles: { thigh: 5 } }]) {
    const start = startSensorsFromDeviceInfo(value);
    assert.deepEqual(start.thigh, { deviceId: null, battery: null });
    assert.equal(requestedHzFromDeviceInfo(value), null);
  }
  assert.equal(requestedHzFromDeviceInfo({ roles: { thigh: { rate: { requested_hz: 200 } } } }), null);
  assert.equal(parseBatteryRecord({ volts: 0, vendor_percent: 10 }), null);
  assert.equal(parseBatteryRecord({ volts: 3.9, vendor_percent: 120 }), null);
  assert.equal(parseBatteryRecord({ volts: "3.9", vendor_percent: 10 }), null);
});

test("the summary has exactly the heel_slide_path.v1 keys", () => {
  const summary = buildHeelSlideSummary(summaryInput());
  assert.deepEqual(Object.keys(summary), [
    "kind",
    "reps_counted_on_device",
    "target_reps",
    "rep_segments",
    "proxy",
    "thresholds",
    "baseline_windows_ms",
    "baseline_window_ms",
    "restarted_after_reload",
    "sensors",
    "telemetry",
  ]);
  assert.equal(summary.kind, "heel_slide_path.v1");
  assert.deepEqual(summary.proxy, {
    definition: "wrap(shank.pitch - thigh.pitch), baseline-zeroed, oriented",
    calibrated: false,
    knee_flexion: false,
  });
  assert.deepEqual(summary.thresholds, { enter_deg: 22.5, exit_deg: 7, min_rep_ms: 250, max_gap_ms: 1000 });
  assert.deepEqual(summary.baseline_windows_ms, [{ start: 9000, end: 9500 }]);
  assert.deepEqual(summary.baseline_window_ms, { start: 9000, end: 9500 });
  assert.deepEqual(summary.rep_segments[0], { start_ms: 10_000, end_ms: 12_000, peak_rel_deg: 61.3 });
  assert.deepEqual(Object.keys(summary.sensors.shank), [
    "device_name",
    "device_id_short",
    "requested_hz",
    "rate_history",
    "delivered_hz",
    "battery_start",
    "battery_end",
    "reconnects",
  ]);
  assert.deepEqual(summary.telemetry, { frames_confirmed: 9000, pending_at_finish: 0, errors: 0, dropped: 0 });
});

test("sensors in the summary carry the rate history, battery and the reconnects that worked", () => {
  const live = roles({
    thigh: {
      rateHistory: [
        { ...confirmed50, atMs: 1000 },
        { ...confirmed50, readbackCode: null, confirmed: false, failure: "no_reply", atMs: 70_000 },
      ],
      reconnect: { state: "idle", attempts: 5, nextAttemptAtMs: null, succeeded: 1 },
      battery: { volts: 3.8, vendorPercent: 45.1, atMs: 900_000 },
    },
  });
  const startSensors = startSensorsFromDeviceInfo(sensorDeviceInfo({ roles: roles() }));
  const summary = buildHeelSlideSummary(summaryInput({ roles: live, startSensors }));
  assert.deepEqual(summary.sensors.thigh.rate_history, [
    { at_ms: 1000, confirmed: true, readback_code: 8, failure: null },
    { at_ms: 70_000, confirmed: false, readback_code: null, failure: "no_reply" },
  ]);
  assert.equal(summary.sensors.thigh.reconnects, 1);
  assert.equal(summary.sensors.thigh.device_id_short, "ABC123");
  assert.equal(summary.sensors.thigh.delivered_hz, 49.5);
  assert.deepEqual(summary.sensors.thigh.battery_start, { volts: 3.92, vendor_percent: 76.7 });
  assert.deepEqual(summary.sensors.thigh.battery_end, { volts: 3.8, vendor_percent: 45.1 });
});

test("every start's zero goes into the summary in time order, and baseline_window_ms is the last one", () => {
  const beforeReload = { start: 9000, end: 9500 };
  const afterReload = { start: 250_000, end: 250_500 };
  const summary = buildHeelSlideSummary(
    summaryInput({
      baselineWindows: [afterReload, { start: 5, end: 5 }, beforeReload, { start: Number.NaN, end: 10 }],
      restartedAfterReload: true,
    }),
  );
  assert.deepEqual(summary.baseline_windows_ms, [beforeReload, afterReload]);
  assert.deepEqual(summary.baseline_window_ms, afterReload);
  assert.notEqual(summary.baseline_window_ms, summary.baseline_windows_ms[1], "a copy, not the same object");
});

test("battery at the start belongs to the device bound at finish", () => {
  const start = { deviceId: "A", battery: { volts: 4, vendor_percent: 100 } };
  const seen = { deviceId: "B", battery: { volts: 3.7, vendor_percent: 15 } };
  assert.deepEqual(pickStartBattery("A", start, seen), start.battery);
  assert.deepEqual(pickStartBattery("B", start, seen), seen.battery, "a swapped device uses its own first reading");
  assert.equal(pickStartBattery("C", start, seen), null);
  assert.equal(pickStartBattery(null, start, seen), null);
  assert.deepEqual(pickStartBattery("A", { deviceId: "A", battery: null }, { deviceId: "A", battery: seen.battery }), seen.battery);
});

test("a failed latest battery read leaves battery_end unknown", () => {
  const summary = buildHeelSlideSummary(summaryInput({ roles: roles({ foot: { batteryError: "no_reply" } }) }));
  assert.equal(summary.sensors.foot.battery_end, null);
});

test("unknowns stay null: no zero, no recorder, unreadable store, unmeasured rate", () => {
  const summary = buildHeelSlideSummary(
    summaryInput({
      baselineWindows: [],
      restartedAfterReload: true,
      repsCounted: 0,
      segments: [],
      targetReps: null,
      maxGapMs: Number.POSITIVE_INFINITY,
      roles: roles({ shank: { deliveredHz: null, deviceId: null, deviceIdShort: null, deviceName: null } }),
      telemetry: { counters: null, pending: null },
    }),
  );
  assert.deepEqual(summary.baseline_windows_ms, []);
  assert.equal(summary.baseline_window_ms, null);
  assert.equal(summary.restarted_after_reload, true);
  assert.equal(summary.target_reps, null);
  assert.equal(summary.thresholds.max_gap_ms, null);
  assert.equal(summary.sensors.shank.delivered_hz, null);
  assert.equal(summary.sensors.shank.battery_start, null);
  assert.equal(summary.sensors.shank.battery_end, null);
  assert.deepEqual(summary.telemetry, { frames_confirmed: null, pending_at_finish: null, errors: null, dropped: null });
});

test("a ten-rep summary with full rate histories stays far under the 64 KB the finish RPC accepts", () => {
  const history = Array.from({ length: 32 }, (_, i) => ({ ...confirmed50, atMs: 1_726_000_000_000 + i }));
  const live = roles({ thigh: { rateHistory: history }, shank: { rateHistory: history }, foot: { rateHistory: history } });
  const bytes = new TextEncoder().encode(JSON.stringify(buildHeelSlideSummary(summaryInput({ roles: live })))).length;
  assert.ok(bytes < 16_000, `${bytes} bytes`);
});

test("pending at finish: a clean stop is zero, otherwise the stored count, else the recorder's, else unknown", async () => {
  let reads = 0;
  const stored = async () => {
    reads += 1;
    return 12;
  };
  const unreadable = async (): Promise<number> => {
    throw new Error("IndexedDB unavailable");
  };
  assert.equal(await pendingAtFinish({ pending: 0 }, stored), 0);
  assert.equal(reads, 0);
  assert.equal(await pendingAtFinish({ pending: 300 }, stored), 12);
  assert.equal(await pendingAtFinish(null, stored), 12);
  assert.equal(await pendingAtFinish({ pending: 300 }, unreadable), 300);
  assert.equal(await pendingAtFinish(null, unreadable), null);
});
