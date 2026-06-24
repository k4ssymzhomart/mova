"use client";

// TelemetryStreamer — buffers derived per-frame telemetry and flushes it to Supabase in batches
// via the record_session_frames / record_fog_events RPCs (migration 0018). It uses the cookie-based
// @supabase/ssr browser client, so writes carry the session cookie the middleware already refreshes;
// the RPCs derive patient_id/clinic_id from auth.uid() and enforce session ownership server-side.
//
// Frames flush on a size OR time trigger (whichever comes first) to bound both latency and round-trips;
// FoG episodes are rare and sent as they close. Network errors are surfaced via counters but never
// throw into the capture loop — a dropped batch must not stop the camera.

import { createClient } from "@/lib/supabase/client";

export interface FrameRow {
  recorded_at: string; // ISO 8601
  seq: number; // monotonic within the session
  joint_angles?: Record<string, number> | null;
  keypoints?: unknown; // derived pose landmarks only (no raw video)
  imu?: unknown; // virtual-IMU window summary + model readout
  quality?: number | null; // 0..1 window coverage / confidence
}

export interface FogEventRow {
  kind: "window" | "episode";
  started_at: string;
  ended_at: string | null;
  confidence: number | null;
  freeze_index: number | null;
  source: string;
}

export interface StreamerCounters {
  framesSent: number;
  eventsSent: number;
  pending: number;
  errors: number;
  lastError: string | null;
}

const BATCH = 24; // flush after this many buffered frames…
const FLUSH_MS = 4000; // …or this often, whichever comes first

export class TelemetryStreamer {
  private readonly supabase = createClient();
  private buf: FrameRow[] = [];
  private inFlight = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly counters: StreamerCounters = {
    framesSent: 0,
    eventsSent: 0,
    pending: 0,
    errors: 0,
    lastError: null,
  };

  constructor(
    private readonly sessionId: string,
    private readonly onUpdate?: (c: StreamerCounters) => void,
  ) {}

  /** Begin the periodic time-based flush. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, FLUSH_MS);
  }

  /** Buffer one derived frame; triggers an early flush once the batch fills. */
  pushFrame(frame: FrameRow): void {
    this.buf.push(frame);
    this.counters.pending = this.buf.length;
    if (this.buf.length >= BATCH) void this.flush();
    this.emit();
  }

  /** Flush all buffered frames as one batch. Safe to call concurrently — it no-ops while in flight. */
  async flush(): Promise<void> {
    if (this.inFlight || this.buf.length === 0) return;
    this.inFlight = true;
    const batch = this.buf.splice(0, this.buf.length);
    try {
      const { data, error } = await this.supabase.rpc("record_session_frames", {
        p_session: this.sessionId,
        p_frames: batch,
      });
      if (error) throw error;
      this.counters.framesSent += typeof data === "number" ? data : batch.length;
    } catch (err) {
      this.counters.errors += 1;
      this.counters.lastError = errMessage(err);
    } finally {
      this.inFlight = false;
      this.counters.pending = this.buf.length;
      this.emit();
    }
  }

  /** Send one or more freshly closed FoG episodes immediately. */
  async sendEvents(events: FogEventRow[]): Promise<void> {
    if (events.length === 0) return;
    try {
      const { data, error } = await this.supabase.rpc("record_fog_events", {
        p_session: this.sessionId,
        p_events: events,
      });
      if (error) throw error;
      this.counters.eventsSent += typeof data === "number" ? data : events.length;
    } catch (err) {
      this.counters.errors += 1;
      this.counters.lastError = errMessage(err);
    } finally {
      this.emit();
    }
  }

  /** Stop the timer and flush whatever remains. Call once on session stop. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private emit(): void {
    this.onUpdate?.({ ...this.counters });
  }
}

function errMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message ?? err);
  }
  return String(err);
}
