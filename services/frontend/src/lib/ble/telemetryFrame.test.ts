import { describe, expect, it } from "vitest";

import { toFrameRow } from "./telemetryFrame";
import type { ParsedWt901Frame } from "./wt901ble68";

const FRAME: ParsedWt901Frame = {
  accelerometerRaw: [-831, -272, 1562],
  gyroscopeRaw: [700, 135, 167],
  eulerDegrees: [12.5, -3.25, 180],
};

describe("toFrameRow", () => {
  it("tags the row with role and passes raw counts through unconverted", () => {
    const row = toFrameRow("shank", FRAME, 7, new Date("2026-01-01T00:00:00.000Z"));

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
    const thigh = toFrameRow("thigh", FRAME, 0, now);
    const shank = toFrameRow("shank", FRAME, 1, now);

    expect(thigh.recorded_at).toBe(shank.recorded_at);
    expect(thigh.seq).not.toBe(shank.seq);
  });
});
