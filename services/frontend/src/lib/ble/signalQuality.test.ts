import { describe, expect, it } from "vitest";

import {
  CLIPPING_RAW_LIMIT,
  MAX_GAP_SECONDS,
  MAX_STATIC_GYROSCOPE_RAW,
  MAX_SYNC_SKEW_MS,
  MIN_SAMPLE_RATE_HZ,
  type SignalQualityEvent,
  describeSignalQuality,
  evaluateSignalQuality,
} from "./signalQuality";

const REST = { ax: -831, ay: -272, az: 1562, gx: 700, gy: 135, gz: 167 }; // real WT901BLE68 at-rest capture

/** 5 seconds of clean, synchronized 20 Hz data across all three roles -- a HIGH baseline to mutate per test. */
function cleanEvents(): SignalQualityEvent[] {
  const events: SignalQualityEvent[] = [];
  const stepMs = 1000 / 20;
  for (let i = 0; i < 100; i += 1) {
    for (const role of ["thigh", "shank", "foot"] as const) {
      events.push({ role, timestampMs: i * stepMs, ...REST });
    }
  }
  return events;
}

describe("evaluateSignalQuality", () => {
  it("is INVALID with the specific missing roles when a sensor never reported", () => {
    const events = cleanEvents().filter((e) => e.role !== "foot");
    const report = evaluateSignalQuality(events);

    expect(report.level).toBe("INVALID");
    expect(report.reasons).toEqual(["missing_sensor_roles:foot"]);
    expect(report.scoringPermitted).toBe(false);
  });

  it("is HIGH and scoring-permitted for clean, synchronized, sufficiently-fast data", () => {
    const report = evaluateSignalQuality(cleanEvents());

    expect(report.level).toBe("HIGH");
    expect(report.reasons).toEqual([]);
    expect(report.scoringPermitted).toBe(true);
    expect(report.synchronizationSkewMs).toBe(0);
  });

  it("does not flag the real hardware at-rest gyro noise floor as motion", () => {
    // REST.g* = 700, well under MAX_STATIC_GYROSCOPE_RAW -- this is the exact value that
    // motivated raising the threshold from 100 to 2000 in Phoenix; must not regress.
    const report = evaluateSignalQuality(cleanEvents());
    expect(report.reasons).not.toContain("static_calibration_motion_detected");
  });

  it("is INVALID on clipping regardless of anything else", () => {
    const events = cleanEvents();
    events[0] = { ...events[0], ax: CLIPPING_RAW_LIMIT };
    const report = evaluateSignalQuality(events);

    expect(report.level).toBe("INVALID");
    expect(report.reasons).toContain("sensor_clipping_detected");
  });

  it("is INVALID on a prolonged gap in one role's stream", () => {
    const events = cleanEvents().map((e) =>
      e.role === "shank" && e.timestampMs > 500 ? { ...e, timestampMs: e.timestampMs + MAX_GAP_SECONDS * 1000 + 200 } : e,
    );
    const report = evaluateSignalQuality(events);

    expect(report.level).toBe("INVALID");
    expect(report.reasons).toContain("prolonged_packet_gap");
  });

  it("is LOW when motion is detected during the static calibration window", () => {
    const events = cleanEvents();
    events[0] = { ...events[0], gx: MAX_STATIC_GYROSCOPE_RAW + 1 };
    const report = evaluateSignalQuality(events);

    expect(report.level).toBe("LOW");
    expect(report.reasons).toContain("static_calibration_motion_detected");
    expect(report.scoringPermitted).toBe(false);
  });

  it("is LOW when a role's sample rate falls below the floor", () => {
    // Thin the shank stream to well under MIN_SAMPLE_RATE_HZ while keeping the others at 20 Hz.
    let shankSeen = 0;
    const events = cleanEvents().filter((e) => e.role !== "shank" || shankSeen++ % 6 === 0);
    const report = evaluateSignalQuality(events);

    expect(report.sampleRatesHz.shank).toBeLessThan(MIN_SAMPLE_RATE_HZ);
    expect(report.level).toBe("LOW");
    expect(report.reasons).toContain("insufficient_sample_rate");
  });

  it("is MEDIUM (still scoring-permitted) when only cross-sensor sync is out of range", () => {
    const events = cleanEvents().map((e) => (e.role === "foot" ? { ...e, timestampMs: e.timestampMs + MAX_SYNC_SKEW_MS + 50 } : e));
    const report = evaluateSignalQuality(events);

    expect(report.level).toBe("MEDIUM");
    expect(report.reasons).toEqual(["sensor_synchronization_out_of_range"]);
    expect(report.scoringPermitted).toBe(true);
  });
});

describe("describeSignalQuality", () => {
  it("names the specific missing roles rather than a generic message", () => {
    const report = evaluateSignalQuality(cleanEvents().filter((e) => e.role === "thigh"));
    expect(describeSignalQuality(report)).toEqual(["Waiting for Foot, Shank."]); // missing roles are reported alphabetically
  });

  it("names the specific slow role for insufficient_sample_rate", () => {
    let shankSeen = 0;
    const events = cleanEvents().filter((e) => e.role !== "shank" || shankSeen++ % 6 === 0);
    const report = evaluateSignalQuality(events);
    expect(describeSignalQuality(report)).toEqual(["Shank is sending data too slowly."]);
  });
});
