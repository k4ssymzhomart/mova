"use client";

// TelemetryBuffer — a resilient, non-blocking edge-telemetry buffer.
//
// The capture loop pushes derived frame packets (and rare FoG episodes) into an in-memory array; the
// buffer flushes them to Supabase in the background via the single batched flush_session_telemetry_batch
// RPC (migration 0021) on a size OR time trigger — every 100 frames or every 2s, whichever comes first.
// DB writes are fire-and-forget from the loop's perspective: pushFrame returns instantly and a flush in
// flight no-ops re-entrant calls, so an insert never blocks the camera / UI thread.
//
// Durability: a clean Stop awaits a final flush, and an abrupt unload (tab close / navigation) triggers
// a best-effort keepalive flush — so no trailing frames are lost. Transient failures re-queue the batch
// (bounded) instead of dropping it. The RPC enforces session ownership server-side via auth.uid().

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

export interface BufferCounters {
  framesSent: number;
  eventsSent: number;
  pending: number;
  errors: number;
  lastError: string | null;
}

const MAX_FRAMES = 100; // flush once the frame buffer reaches this…
const FLUSH_MS = 2000; // …or this often, whichever comes first
const MAX_BUFFER = 1000; // hard cap so a sustained outage can't grow memory unbounded

type AuthCtx = { url: string; key: string; token: string };

export class TelemetryBuffer {
  private readonly supabase = createClient();
  private frames: FrameRow[] = [];
  private events: FogEventRow[] = [];
  private inFlight = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private auth: AuthCtx | null = null;
  readonly counters: BufferCounters = {
    framesSent: 0,
    eventsSent: 0,
    pending: 0,
    errors: 0,
    lastError: null,
  };

  constructor(
    private readonly sessionId: string,
    private readonly onUpdate?: (c: BufferCounters) => void,
  ) {}

  /** Begin the periodic flush loop and arm the unload safety net. */
  async start(): Promise<void> {
    await this.refreshAuth(); // cache a token so the unload path can flush with auth headers
    if (!this.timer) this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.onUnload);
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  /** Buffer one derived frame. Returns instantly; triggers an early flush once the batch fills. */
  pushFrame(frame: FrameRow): void {
    this.frames.push(frame);
    if (this.frames.length > MAX_BUFFER) this.frames.splice(0, this.frames.length - MAX_BUFFER);
    if (this.frames.length >= MAX_FRAMES) void this.flush();
    this.counters.pending = this.frames.length + this.events.length;
    this.emit();
  }

  /** Buffer one FoG episode. Episodes are rare + clinically important, so push promptly. */
  pushEvent(event: FogEventRow): void {
    this.events.push(event);
    if (this.events.length > MAX_BUFFER) this.events.splice(0, this.events.length - MAX_BUFFER);
    void this.flush();
    this.counters.pending = this.frames.length + this.events.length;
    this.emit();
  }

  /** Flush all buffered frames + events as one batch. Safe to call concurrently — no-ops while in flight. */
  async flush(): Promise<void> {
    if (this.inFlight) return;
    if (this.frames.length === 0 && this.events.length === 0) return;
    this.inFlight = true;
    const fb = this.frames;
    const eb = this.events;
    this.frames = [];
    this.events = [];
    try {
      const { data, error } = await this.supabase.rpc("flush_session_telemetry_batch", {
        p_session: this.sessionId,
        p_frames: fb,
        p_events: eb,
      });
      if (error) throw error;
      const res = (data ?? {}) as { frames?: number; events?: number };
      this.counters.framesSent += res.frames ?? fb.length;
      this.counters.eventsSent += res.events ?? eb.length;
      void this.refreshAuth(); // keep the unload token fresh
    } catch (err) {
      // Resilient: re-queue (bounded) so a transient failure doesn't drop telemetry.
      this.frames = [...fb, ...this.frames].slice(-MAX_BUFFER);
      this.events = [...eb, ...this.events].slice(-MAX_BUFFER);
      this.counters.errors += 1;
      this.counters.lastError = errMessage(err);
    } finally {
      this.inFlight = false;
      this.counters.pending = this.frames.length + this.events.length;
      this.emit();
    }
  }

  /** Stop the loop, detach the unload net, and flush whatever remains. Call once on session stop. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.onUnload);
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    await this.flush();
  }

  // — unload safety net —————————————————————————————————————————————————————

  private onVisibility = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") this.onUnload();
  };

  // Best-effort flush during an abrupt unload. Uses fetch + keepalive (which, unlike navigator.sendBeacon,
  // can carry the Authorization header PostgREST requires) so a closing tab still delivers its last batch.
  // Never throws.
  private onUnload = (): void => {
    if (this.frames.length === 0 && this.events.length === 0) return;
    const auth = this.auth;
    if (!auth) return;
    const fb = this.frames;
    const eb = this.events;
    this.frames = [];
    this.events = [];
    try {
      void fetch(`${auth.url}/rest/v1/rpc/flush_session_telemetry_batch`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          apikey: auth.key,
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ p_session: this.sessionId, p_frames: fb, p_events: eb }),
      });
    } catch {
      /* best-effort — the awaited stop() is the primary guarantee */
    }
  };

  private async refreshAuth(): Promise<void> {
    try {
      const { data } = await this.supabase.auth.getSession();
      const token = data.session?.access_token;
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (token && url && key) this.auth = { url, key, token };
    } catch {
      /* ignore — periodic flush still works via the supabase client */
    }
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
