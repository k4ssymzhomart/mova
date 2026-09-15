"use client";

// TelemetryBuffer — a resilient, non-blocking edge-telemetry buffer.
//
// The capture loop pushes frame rows (and rare FoG episodes) into memory; the buffer flushes them to Supabase in
// the background through the single batched flush_session_telemetry_batch RPC (migration 0021), idempotent on
// (session_id, recorded_at, seq). pushFrame returns instantly and never waits on the network.
//
// Sized for three BLE sensors at 50 Hz, i.e. about 150 rows a second: a flush starts once 150 rows are queued or
// every second, whichever comes first, and one RPC carries at most 600 rows, so a backlog drains in bounded
// requests instead of one oversized call. Memory holds 45 000 rows, five minutes of outage at that rate; beyond
// it the oldest rows are dropped and counted in `framesDropped`, never silently.
//
// Durability, in three layers:
//  - A clean stop() drains the queue (several RPCs if a backlog built up) and awaits the result.
//  - Transient RPC failures re-queue the batch instead of dropping it.
//  - A reload or crash mid-outage: DurableQueue mirrors everything still unacknowledged (queued + in flight) into
//    IndexedDB, and start() recovers it. The mirror is a whole-array rewrite, so it is throttled to at most about
//    once a second (plus a forced write on stop and on page hide) rather than on every push, which at 150 pushes
//    a second would rewrite a growing array quadratically. The price is a loss window: a crash can lose up to
//    about one second of rows pushed since the last write. Rows resent after recovery are harmless thanks to the
//    RPC's idempotency.
//
// On page hide or unload a best-effort keepalive request also sends the oldest queued rows. Browsers cap a
// keepalive body at 64 KiB, so the batch is trimmed to fit; the rows stay queued (hidden is not always gone),
// and a later flush that resends them is a no-op in Postgres.

import { createClient } from "@/lib/supabase/client";

import { DurableQueue } from "./durableQueue";

export interface FrameRow {
  recorded_at: string; // ISO 8601
  seq: number; // monotonic within the session
  joint_angles?: Record<string, number> | null;
  keypoints?: unknown; // derived pose landmarks only (no raw video)
  imu?: unknown; // virtual-IMU window summary + model readout, or one raw BLE sample
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
  /** Rows not yet acknowledged by Postgres: queued plus in flight. */
  pending: number;
  errors: number;
  lastError: string | null;
  /** Oldest rows discarded after the in-memory cap was hit. Always set by TelemetryBuffer. */
  framesDropped?: number;
}

export const FLUSH_FRAMES = 150; // flush once this many rows are queued…
export const FLUSH_MS = 1000; // …or this often, whichever comes first
export const MAX_BATCH_FRAMES = 600; // rows per RPC; a backlog drains over several calls
export const MAX_BUFFER = 45_000; // five minutes at 150 rows/s before the oldest rows are dropped
export const PERSIST_MS = 1000; // at most one durable rewrite per interval
export const EMIT_MS = 250; // counter updates to the UI while rows stream in
export const KEEPALIVE_MAX_BYTES = 60_000; // under the 64 KiB keepalive body cap

const OVERFLOW_SLACK = 1_500; // trim in bulk, not one splice per push, once over the cap

export type AuthCtx = { url: string; key: string; token: string };

export type FlushRpcArgs = { p_session: string; p_frames: FrameRow[]; p_events: FogEventRow[] };

export type FlushRpc = (args: FlushRpcArgs) => Promise<{ data: unknown; error: { message?: string } | null }>;

/** Test seams. Production uses the browser Supabase client and IndexedDB. */
export interface TelemetryBufferDeps {
  rpc?: FlushRpc;
  getAuth?: () => Promise<AuthCtx | null>;
  durable?: Pick<DurableQueue, "save" | "load" | "clear">;
}

export class TelemetryBuffer {
  private readonly rpc: FlushRpc;
  private readonly getAuth: () => Promise<AuthCtx | null>;
  private readonly durable: Pick<DurableQueue, "save" | "load" | "clear">;
  private frames: FrameRow[] = [];
  private events: FogEventRow[] = [];
  // Set only for the span of an in-flight flush -- the durable record must count these alongside
  // `frames`/`events`, so a write mid-flight never durably drops a batch still in transit.
  private inFlightFrames: FrameRow[] = [];
  private inFlightEvents: FogEventRow[] = [];
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistQueued = false;
  private persistChain: Promise<void> = Promise.resolve();
  private lastEmitAt = 0;
  private auth: AuthCtx | null = null;
  readonly counters: Required<BufferCounters> = {
    framesSent: 0,
    eventsSent: 0,
    pending: 0,
    errors: 0,
    lastError: null,
    framesDropped: 0,
  };

  constructor(
    private readonly sessionId: string,
    private readonly onUpdate?: (c: BufferCounters) => void,
    deps: TelemetryBufferDeps = {},
  ) {
    let client: ReturnType<typeof createClient> | null = null;
    const supabase = () => (client ??= createClient());
    this.rpc = deps.rpc ?? (async (args) => supabase().rpc("flush_session_telemetry_batch", args));
    this.getAuth = deps.getAuth ?? (() => sessionAuth(supabase()));
    this.durable = deps.durable ?? new DurableQueue();
  }

  /** Begin the periodic flush loop and arm the unload safety net. Recovers anything a
   * previous instance for this same session left undelivered (crash, unclean reload). */
  async start(): Promise<void> {
    await this.recoverDurable();
    await this.refreshAuth(); // cache a token so the unload path can flush with auth headers
    if (!this.timer) this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.onUnload);
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  /** Buffer one frame row. Returns instantly; starts an early flush once a batch is queued. */
  pushFrame(frame: FrameRow): void {
    this.frames.push(frame);
    if (this.frames.length > MAX_BUFFER + OVERFLOW_SLACK) {
      const excess = this.frames.length - MAX_BUFFER;
      this.frames.splice(0, excess);
      this.counters.framesDropped += excess;
    }
    if (this.frames.length >= FLUSH_FRAMES) void this.flush();
    this.schedulePersist();
    this.emit(false);
  }

  /** Buffer one FoG episode. Episodes are rare + clinically important, so push promptly. */
  pushEvent(event: FogEventRow): void {
    this.events.push(event);
    void this.flush();
    this.schedulePersist();
    this.emit(true);
  }

  /** Send the oldest queued rows (up to one batch) plus all events. Concurrent calls share the flush in flight. */
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.frames.length === 0 && this.events.length === 0) return Promise.resolve();
    this.flushing = this.sendBatch().catch(() => false).then((delivered) => {
      this.flushing = null;
      // Keep draining a backlog while the network is healthy; after a failure, wait for the timer.
      if (delivered && this.frames.length >= FLUSH_FRAMES) void this.flush();
    });
    return this.flushing;
  }

  /** Stop the loop, detach the unload net, drain what remains and force the durable record current. */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.onUnload);
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    const maxRounds = Math.ceil(MAX_BUFFER / MAX_BATCH_FRAMES) + 2;
    for (let round = 0; round < maxRounds; round += 1) {
      if (!this.flushing && this.frames.length === 0 && this.events.length === 0) break;
      const errorsBefore = this.counters.errors;
      await this.flush();
      if (this.counters.errors > errorsBefore) break; // offline: leave the rest to the durable record
    }
    await this.persistNow();
  }

  private async sendBatch(): Promise<boolean> {
    this.inFlightFrames = this.frames.slice(0, MAX_BATCH_FRAMES);
    this.frames = this.frames.slice(this.inFlightFrames.length);
    this.inFlightEvents = this.events;
    this.events = [];
    let delivered = false;
    try {
      const { data, error } = await this.rpc({
        p_session: this.sessionId,
        p_frames: this.inFlightFrames,
        p_events: this.inFlightEvents,
      });
      if (error) throw error;
      const res = (data ?? {}) as { frames?: number; events?: number };
      this.counters.framesSent += res.frames ?? this.inFlightFrames.length;
      this.counters.eventsSent += res.events ?? this.inFlightEvents.length;
      this.inFlightFrames = [];
      this.inFlightEvents = [];
      delivered = true;
      void this.refreshAuth(); // keep the unload token fresh
    } catch (err) {
      // Resilient: re-queue ahead of newer rows so a transient failure doesn't drop telemetry.
      this.frames = [...this.inFlightFrames, ...this.frames];
      this.events = [...this.inFlightEvents, ...this.events];
      this.inFlightFrames = [];
      this.inFlightEvents = [];
      this.counters.errors += 1;
      this.counters.lastError = errMessage(err);
    }
    this.schedulePersist();
    this.emit(true);
    return delivered;
  }

  // — unload safety net —————————————————————————————————————————————————————

  private onVisibility = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") this.onUnload();
  };

  // Best-effort delivery while the page is hidden or going away. Uses fetch + keepalive (which, unlike
  // navigator.sendBeacon, can carry the Authorization header PostgREST requires). Never throws.
  private onUnload = (): void => {
    void this.persistNow();
    if (this.frames.length === 0 && this.events.length === 0) return;
    const auth = this.auth;
    if (!auth) return;
    const body = keepaliveBody(this.sessionId, this.frames, this.events);
    if (!body) return;
    try {
      void fetch(`${auth.url}/rest/v1/rpc/flush_session_telemetry_batch`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          apikey: auth.key,
          Authorization: `Bearer ${auth.token}`,
        },
        body,
      }).catch(() => undefined);
    } catch {
      /* best-effort — the awaited stop() and the durable record are the guarantees */
    }
  };

  // — durable queue (survives a reload/crash, not just a graceful close) ——————————————

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, PERSIST_MS);
  }

  // Writes are chained so an older snapshot can never land after a newer one, and coalesced: while one write
  // is waiting its turn, further requests ride on it. The snapshot is taken when the write starts, so it always
  // reflects the full undelivered set at that moment (queued + in flight).
  private persistNow(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.persistQueued) return this.persistChain;
    this.persistQueued = true;
    this.persistChain = this.persistChain
      .then(async () => {
        this.persistQueued = false;
        const frames = [...this.inFlightFrames, ...this.frames];
        const events = [...this.inFlightEvents, ...this.events];
        if (frames.length === 0 && events.length === 0) await this.durable.clear(this.sessionId);
        else await this.durable.save(this.sessionId, frames, events);
      })
      .catch(() => undefined);
    return this.persistChain;
  }

  // Called once from start(): recovers anything left behind by a previous instance for this
  // same session that never got to run stop()'s final flush (crash, unclean reload). Prepended
  // so recovered data flushes ahead of anything pushed after this instance starts.
  private async recoverDurable(): Promise<void> {
    const saved = await this.durable.load(this.sessionId);
    if (!saved) return;
    const frames = [...saved.frames, ...this.frames];
    if (frames.length > MAX_BUFFER) this.counters.framesDropped += frames.length - MAX_BUFFER;
    this.frames = frames.slice(-MAX_BUFFER);
    this.events = [...saved.events, ...this.events];
    this.emit(true);
  }

  private async refreshAuth(): Promise<void> {
    try {
      const auth = await this.getAuth();
      if (auth) this.auth = auth;
    } catch {
      /* ignore — periodic flush still works via the supabase client */
    }
  }

  private emit(force: boolean): void {
    this.counters.pending =
      this.inFlightFrames.length + this.frames.length + this.inFlightEvents.length + this.events.length;
    const now = Date.now();
    if (!force && now - this.lastEmitAt < EMIT_MS) return;
    this.lastEmitAt = now;
    this.onUpdate?.({ ...this.counters });
  }
}

/**
 * The JSON body for a keepalive flush: every event plus as many of the oldest frames as fit in `maxBytes`
 * (halving until it fits). Null when not even the events alone fit.
 */
export function keepaliveBody(
  sessionId: string,
  frames: readonly FrameRow[],
  events: readonly FogEventRow[],
  maxBytes: number = KEEPALIVE_MAX_BYTES,
): string | null {
  const encoder = new TextEncoder();
  let count = frames.length;
  for (;;) {
    const body = JSON.stringify({ p_session: sessionId, p_frames: frames.slice(0, count), p_events: events });
    if (encoder.encode(body).length <= maxBytes) return body;
    if (count === 0) return null;
    count = Math.floor(count / 2);
  }
}

async function sessionAuth(supabase: ReturnType<typeof createClient>): Promise<AuthCtx | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return token && url && key ? { url, key, token } : null;
}

function errMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message ?? err);
  }
  return String(err);
}
