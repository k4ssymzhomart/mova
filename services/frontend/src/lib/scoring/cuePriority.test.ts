import { describe, expect, it } from "vitest";

import type { SignalQualityReport } from "@/lib/ble/signalQuality";
import { selectCue } from "./cuePriority";
import { EXERCISE_CONFIGS } from "./exerciseConfigs";
import type { RepResult } from "./types";

const config = EXERCISE_CONFIGS.heel_slide;

const OK_SIGNAL: SignalQualityReport = {
  level: "HIGH",
  reasons: [],
  calibrationDurationSeconds: 3,
  synchronizationSkewMs: 0,
  sampleRatesHz: {},
  packetCounts: { thigh: 10, shank: 10, foot: 10 },
  scoringPermitted: true,
};
const BAD_SIGNAL: SignalQualityReport = {
  ...OK_SIGNAL,
  level: "INVALID",
  reasons: ["sensor_clipping_detected"],
  scoringPermitted: false,
};

function rep(overrides: Partial<RepResult> = {}): RepResult {
  return {
    index: 0,
    startedAtMs: 0,
    endedAtMs: 1000,
    peakExcursionDeg: 90,
    completed: true,
    validForVolume: true,
    tempoSec: 4,
    smoothness01: 0.9,
    holdSec: 0,
    lossReason: null,
    ...overrides,
  };
}

describe("selectCue — priority ladder", () => {
  it("priority 1 (sensor) wins over everything, even a perfect completed rep", () => {
    const cue = selectCue({ signal: BAD_SIGNAL, lastCompletedRep: rep(), config, nowMs: 1000 }, null);
    expect(cue?.priority).toBe(1);
    expect(cue?.code).toBe("sensor_problem");
  });

  it("debounces the sensor cue: does not re-fire within 1.5s of the last one", () => {
    const first = selectCue({ signal: BAD_SIGNAL, lastCompletedRep: null, config, nowMs: 1000 }, null);
    const second = selectCue({ signal: BAD_SIGNAL, lastCompletedRep: null, config, nowMs: 1200 }, first);
    expect(second).toBe(first); // same object — held, not re-emitted
  });

  it("re-fires the sensor cue after the debounce window elapses", () => {
    const first = selectCue({ signal: BAD_SIGNAL, lastCompletedRep: null, config, nowMs: 1000 }, null);
    const second = selectCue({ signal: BAD_SIGNAL, lastCompletedRep: null, config, nowMs: 3000 }, first);
    expect(second).not.toBe(first);
    expect(second?.emittedAtMs).toBe(3000);
  });

  it("priority 2: an incomplete (abandoned) rep beats a good target score", () => {
    const cue = selectCue({ signal: OK_SIGNAL, lastCompletedRep: rep({ completed: false }), config, nowMs: 1000 }, null);
    expect(cue?.priority).toBe(2);
    expect(cue?.code).toBe("rep_incomplete");
  });

  it("priority 3: target far below 85% even with a fast, smooth rep", () => {
    const cue = selectCue({ signal: OK_SIGNAL, lastCompletedRep: rep({ peakExcursionDeg: 50 }), config, nowMs: 1000 }, null);
    expect(cue?.priority).toBe(3);
    expect(cue?.code).toBe("target_far");
  });

  it("priority 4: target close (85-99%)", () => {
    const cue = selectCue({ signal: OK_SIGNAL, lastCompletedRep: rep({ peakExcursionDeg: 87 }), config, nowMs: 1000 }, null);
    expect(cue?.priority).toBe(4);
    expect(cue?.code).toBe("target_close");
  });

  it("priority 5: target reached but too fast", () => {
    const cue = selectCue(
      { signal: OK_SIGNAL, lastCompletedRep: rep({ peakExcursionDeg: 95, tempoSec: 1 }), config, nowMs: 1000 },
      null,
    );
    expect(cue?.priority).toBe(5);
    expect(cue?.code).toBe("too_fast");
  });

  it("priority 6: target reached, good tempo, but low smoothness", () => {
    const cue = selectCue(
      { signal: OK_SIGNAL, lastCompletedRep: rep({ peakExcursionDeg: 95, tempoSec: 4, smoothness01: 0.2 }), config, nowMs: 1000 },
      null,
    );
    expect(cue?.priority).toBe(6);
    expect(cue?.code).toBe("low_smoothness");
  });

  it("priority 7: a clean rep gets the all-good cue", () => {
    const cue = selectCue(
      { signal: OK_SIGNAL, lastCompletedRep: rep({ peakExcursionDeg: 95, tempoSec: 4, smoothness01: 0.95 }), config, nowMs: 1000 },
      null,
    );
    expect(cue?.priority).toBe(7);
    expect(cue?.code).toBe("all_good");
  });

  it("shows exactly one cue per rep: a second call for the same rep returns the held cue unchanged", () => {
    const goodRep = rep({ peakExcursionDeg: 95, tempoSec: 4, smoothness01: 0.95 });
    const first = selectCue({ signal: OK_SIGNAL, lastCompletedRep: goodRep, config, nowMs: 1000 }, null);
    const second = selectCue({ signal: OK_SIGNAL, lastCompletedRep: goodRep, config, nowMs: 1500 }, first);
    expect(second).toBe(first);
  });

  it("never says 'bend further' once the target is reached — target_far/target_close cannot fire for a rep at or above 100% target score", () => {
    const cue = selectCue(
      { signal: OK_SIGNAL, lastCompletedRep: rep({ peakExcursionDeg: 120, tempoSec: 4, smoothness01: 0.95 }), config, nowMs: 1000 },
      null,
    );
    expect(cue?.code).not.toBe("target_far");
    expect(cue?.code).not.toBe("target_close");
  });
});
