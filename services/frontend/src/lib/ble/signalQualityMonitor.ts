import type { SensorRole } from "./roles";
import { type SignalQualityEvent, type SignalQualityReport, evaluateSignalQuality } from "./signalQuality";

/** How much recent history feeds each evaluation -- long enough to cover
 * MIN_CALIBRATION_SECONDS with margin, short enough that the report reflects
 * current conditions rather than the whole session. */
const WINDOW_MS = 6000;

export interface RawSample {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
}

/** Keeps a rolling per-role sample window and evaluates it on demand. Feed it live BLE
 * frames as they arrive; call `evaluate()` periodically (e.g. once a second) for display. */
export class SignalQualityMonitor {
  private events: SignalQualityEvent[] = [];

  push(role: SensorRole, sample: RawSample, timestampMs: number = Date.now()): void {
    this.events.push({ role, timestampMs, ...sample });
    const cutoff = timestampMs - WINDOW_MS;
    let dropTo = 0;
    while (dropTo < this.events.length && this.events[dropTo].timestampMs < cutoff) dropTo += 1;
    if (dropTo > 0) this.events.splice(0, dropTo);
  }

  evaluate(): SignalQualityReport {
    return evaluateSignalQuality(this.events);
  }

  reset(): void {
    this.events = [];
  }
}
