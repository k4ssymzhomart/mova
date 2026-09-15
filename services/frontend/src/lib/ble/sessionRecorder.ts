import { TelemetryBuffer, type BufferCounters, type FrameRow } from "@/lib/telemetry/buffer";

import type { SensorRole } from "./roles";
import type { SignalQualityReport } from "./signalQuality";
import { SignalQualityMonitor } from "./signalQualityMonitor";
import { toFrameRow } from "./telemetryFrame";
import type { ParsedWt901Frame } from "./wt901ble68";

/**
 * Records every BLE frame of a session into `session_frames` through
 * TelemetryBuffer: all three roles, one row per frame, batched instead of
 * Phoenix's one fetch per frame.
 *
 * - One session-wide `seq` (not per role), so two roles reporting in the same
 *   millisecond never collide on the (session_id, recorded_at, seq) key.
 * - `recorded_at` is the browser receive time the caller passes in; the frame
 *   has no device clock.
 * - Signal quality is evaluated at most once a second. The full report rides
 *   only on the row taken at that tick; every row carries the latest rollup in
 *   `quality` (null until the first evaluation).
 *
 * No resampling, no cross-role alignment, no unit conversion -- see `toFrameRow`.
 * start/stop are queued behind each other, so a quick stop-then-start (React
 * strict mode, a remount) never interleaves two buffers for the same session.
 */

export const QUALITY_EVALUATION_INTERVAL_MS = 1000;

export const ZERO_COUNTERS: BufferCounters = {
  framesSent: 0,
  eventsSent: 0,
  pending: 0,
  errors: 0,
  lastError: null,
  framesDropped: 0,
};

export interface RecorderBuffer {
  start(): Promise<void>;
  stop(): Promise<void>;
  pushFrame(row: FrameRow): void;
  readonly counters: BufferCounters;
}

export interface BleSessionRecorderOptions {
  onCounters?: (counters: BufferCounters) => void;
  /** Test seam; defaults to a real TelemetryBuffer. */
  createBuffer?: (sessionId: string, onUpdate: (counters: BufferCounters) => void) => RecorderBuffer;
}

export class BleSessionRecorder {
  private buffer: RecorderBuffer | null = null;
  private seq = 0;
  private recorded = 0;
  private readonly monitor = new SignalQualityMonitor();
  private quality: SignalQualityReport | null = null;
  private lastEvaluatedAt: number | null = null;
  private lifecycle: Promise<unknown> = Promise.resolve();
  private readonly onCounters?: (counters: BufferCounters) => void;
  private readonly createBuffer: NonNullable<BleSessionRecorderOptions["createBuffer"]>;

  constructor({ onCounters, createBuffer }: BleSessionRecorderOptions = {}) {
    this.onCounters = onCounters;
    this.createBuffer = createBuffer ?? ((sessionId, onUpdate) => new TelemetryBuffer(sessionId, onUpdate));
  }

  /** Begin recording into `sessionId`. Stops (and drains) a previous session first. */
  start(sessionId: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.buffer) await this.stopBuffer();
      this.seq = 0;
      this.recorded = 0;
      this.monitor.reset();
      this.quality = null;
      this.lastEvaluatedAt = null;
      const buffer = this.createBuffer(sessionId, (counters) => this.onCounters?.(counters));
      this.buffer = buffer;
      this.onCounters?.(ZERO_COUNTERS);
      await buffer.start();
    });
  }

  /** Stop and await the final drain. Resolves with the final counters, or null when nothing was recording. */
  stop(): Promise<BufferCounters | null> {
    return this.enqueue(() => this.stopBuffer());
  }

  /** Queue one frame. Non-blocking; ignored while no session is recording. */
  recordFrame(role: SensorRole, frame: ParsedWt901Frame, receivedAtMs: number): void {
    const buffer = this.buffer;
    if (!buffer) return;
    this.monitor.push(
      role,
      {
        ax: frame.accelerometerRaw[0],
        ay: frame.accelerometerRaw[1],
        az: frame.accelerometerRaw[2],
        gx: frame.gyroscopeRaw[0],
        gy: frame.gyroscopeRaw[1],
        gz: frame.gyroscopeRaw[2],
      },
      receivedAtMs,
    );
    // A clock stepping backwards also counts as a tick, so evaluation cannot stall.
    const tick =
      this.lastEvaluatedAt === null ||
      receivedAtMs < this.lastEvaluatedAt ||
      receivedAtMs - this.lastEvaluatedAt >= QUALITY_EVALUATION_INTERVAL_MS;
    if (tick) {
      this.quality = this.monitor.evaluate();
      this.lastEvaluatedAt = receivedAtMs;
    }
    buffer.pushFrame(
      toFrameRow(role, frame, this.seq, { recordedAt: new Date(receivedAtMs), quality: this.quality, attachReport: tick }),
    );
    this.seq += 1;
    this.recorded += 1;
  }

  /** The most recent evaluation, or null before the first frame. */
  get lastQuality(): SignalQualityReport | null {
    return this.quality;
  }

  /** Frames handed to the buffer since start (sent or not). */
  get framesRecorded(): number {
    return this.recorded;
  }

  private async stopBuffer(): Promise<BufferCounters | null> {
    const buffer = this.buffer;
    this.buffer = null;
    if (!buffer) return null;
    await buffer.stop();
    const counters = { ...buffer.counters };
    this.onCounters?.(counters);
    return counters;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lifecycle.then(task);
    this.lifecycle = run.catch(() => undefined);
    return run;
  }
}
