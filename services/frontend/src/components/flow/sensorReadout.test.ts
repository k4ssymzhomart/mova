import assert from "node:assert/strict";
import { test } from "node:test";

import {
  batteryReasonKey,
  batteryView,
  formatClockTime,
  formatNumber,
  hexCode,
  linkLabelKey,
  rateView,
  secondsUntil,
  shortBatteryPercent,
  wholeSeconds,
} from "./sensorReadout.ts";

const idle = { state: "idle", attempts: 0, nextAttemptAtMs: null, succeeded: 0 } as const;

test("a link brought back on its own reads as reconnecting", () => {
  assert.equal(linkLabelKey({ link: "connecting", reconnect: idle }), "sensors.link.connecting");
  assert.equal(
    linkLabelKey({ link: "connecting", reconnect: { ...idle, state: "reconnecting", attempts: 2 } }),
    "flow.sensors.reconnecting",
  );
  assert.equal(linkLabelKey({ link: "lost", reconnect: { ...idle, state: "gave_up", attempts: 15 } }), "sensors.link.lost");
});

test("clock times carry seconds", () => {
  assert.equal(formatClockTime("ru", Date.UTC(2026, 8, 15, 14, 5, 9), "UTC"), "14:05:09");
  assert.equal(formatClockTime("en", Date.UTC(2026, 8, 15, 0, 0, 1), "UTC"), "00:00:01");
});

test("battery failure reasons map to known keys only", () => {
  assert.equal(batteryReasonKey("no_reply"), "flow.readout.batteryReason.no_reply");
  assert.equal(batteryReasonKey("implausible_value"), "flow.readout.batteryReason.implausible_value");
  assert.equal(batteryReasonKey("something else"), "flow.readout.batteryReason.unknown");
});

test("register codes read the way the protocol writes them", () => {
  assert.equal(hexCode(0x08), "0x08");
  assert.equal(hexCode(0x09), "0x09");
  assert.equal(hexCode(10), "0x0A");
  assert.equal(hexCode(0x64), "0x64");
});

test("numbers follow the locale", () => {
  assert.equal(formatNumber("ru", 3.92, 2), "3,92");
  assert.equal(formatNumber("en", 3.92, 2), "3.92");
  assert.equal(formatNumber("ru", 49.46, 1), "49,5");
  assert.equal(formatNumber("en", 76.7), "77");
});

test("durations are whole seconds, never negative", () => {
  assert.equal(wholeSeconds(31_999), 31);
  assert.equal(wholeSeconds(-5), 0);
  assert.equal(secondsUntil(null, 1000), null);
  assert.equal(secondsUntil(5_500, 1000), 5);
  assert.equal(secondsUntil(500, 1000), 0);
});

test("battery: a failed latest read is unknown, and the short percent is shown only for a good read", () => {
  const reading = { volts: 3.92, vendorPercent: 76.7, atMs: 1 };
  assert.deepEqual(batteryView({ battery: reading, batteryError: null }), { kind: "reading", reading });
  assert.deepEqual(batteryView({ battery: reading, batteryError: "no_reply" }), {
    kind: "failed",
    reason: "no_reply",
    lastReading: reading,
  });
  assert.deepEqual(batteryView({ battery: null, batteryError: null }), { kind: "unread" });
  assert.equal(shortBatteryPercent({ battery: reading, batteryError: null }), 77);
  assert.equal(shortBatteryPercent({ battery: reading, batteryError: "write_failed" }), null);
  assert.equal(shortBatteryPercent({ battery: null, batteryError: null }), null);
});

test("a rate readback is a current confirmation only while the sensor streams; otherwise it is a dated past check", () => {
  const result = {
    requestedHz: 50 as const,
    requestedCode: 0x08,
    readbackCode: 0x08,
    confirmed: true,
    attempts: 1,
    failure: null,
    errorMessage: null,
    finishedAt: 0,
  };
  const history = [{ ...result, atMs: 1_000 }, { ...result, atMs: 61_000 }];
  const done = { status: "done", result } as const;

  assert.deepEqual(rateView({ link: "streaming", rate: done, rateHistory: history }), { kind: "current", result });
  for (const link of ["connecting", "lost", "disconnected"] as const) {
    assert.deepEqual(rateView({ link, rate: done, rateHistory: history }), { kind: "last", result, atMs: 61_000 }, link);
  }
  assert.deepEqual(rateView({ link: "lost", rate: done, rateHistory: [] }), { kind: "none" });
  assert.deepEqual(rateView({ link: "connecting", rate: { status: "configuring", requestedHz: 100 }, rateHistory: history }), {
    kind: "configuring",
    requestedHz: 100,
  });
  assert.deepEqual(rateView({ link: "streaming", rate: { status: "idle" }, rateHistory: [] }), { kind: "none" });
});
