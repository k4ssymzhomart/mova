import { describe, expect, it } from "vitest";

import type { SignalQualityReport } from "./signalQuality";
import { toFrameRow } from "./telemetryFrame";
import type { ParsedWt901Frame } from "./wt901ble68";

const FRAME: ParsedWt901Frame = {
  accelerometerRaw: [-831, -272, 1562],
  gyroscopeRaw: [700, 135, 167],
  eulerDegrees: [12.5, -3.25, 180],
};

const QUALITY: SignalQualityReport = {
  level: "MEDIUM",
  reasons: ["sensor_synchronization_out_of_range"],
  calibrationDurationSeconds: 5,
  synchronizationSkewMs: 300,
  sampleRatesHz: { thigh: 20, shank: 20, foot: 20 },
  packetCounts: { thigh: 100, shank: 100, foot: 100 },
  scoringPermitted: true,
};

describe("toFrameRow", () => {
  it("tags the row with role and passes raw counts through unconverted", () => {
    const row = toFrameRow("shank", FRAME, 7, { recordedAt: new Date("2026-01-01T00:00:00.000Z") });

    expect(row.seq).toBe(7);
    expect(row.recorded_at).toBe("2026-01-01T00:00:00.000Z");
    expect(row.imu).toEqual({
      role: "shank",
      ax: -831,
      ay: -272,
      az: 1562,
      gx: 700,
      gy: 135,
      gz: 167,
      euler_deg: [12.5, -3.25, 180],
      validation_status: "unverified_checksum",
    });
    expect(row.quality).toBeNull();
  });

  it("defaults recorded_at to now when omitted", () => {
    const before = Date.now();
    const row = toFrameRow("thigh", FRAME, 0);
    const after = Date.now();

    const recordedMs = new Date(row.recorded_at).getTime();
    expect(recordedMs).toBeGreaterThanOrEqual(before);
    expect(recordedMs).toBeLessThanOrEqual(after);
  });

  it("keeps distinct roles independently seq-numbered so the same instant never collides", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const thigh = toFrameRow("thigh", FRAME, 0, { recordedAt: now });
    const shank = toFrameRow("shank", FRAME, 1, { recordedAt: now });

    expect(thigh.recorded_at).toBe(shank.recorded_at);
    expect(thigh.seq).not.toBe(shank.seq);
  });

  it("rolls a report into the numeric quality column and embeds it in full only when asked", () => {
    const tick = toFrameRow("thigh", FRAME, 0, { quality: QUALITY, attachReport: true });
    const between = toFrameRow("thigh", FRAME, 1, { quality: QUALITY });

    expect(tick.quality).toBe(0.6);
    expect((tick.imu as { signal_quality: SignalQualityReport }).signal_quality).toEqual(QUALITY);
    expect(between.quality).toBe(0.6);
    expect(between.imu).not.toHaveProperty("signal_quality");
  });

  it("keeps pitch at euler index 1", () => {
    const row = toFrameRow("shank", FRAME, 0);
    expect((row.imu as { euler_deg: number[] }).euler_deg[1]).toBe(-3.25);
  });
});
