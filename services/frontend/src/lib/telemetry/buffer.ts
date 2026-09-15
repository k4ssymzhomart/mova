"use client";

// TelemetryBuffer — a resilient, non-blocking edge-telemetry buffer.
//
// The capture loop pushes frame rows (and rare FoG episodes) into memory; the buffer flushes them to Supabase in
// the background through the single batched flush_session_telemetry_batch RPC (migration 0021, redefined in 0034),
// idempotent on (session_id, recorded_at, seq). pushFrame returns instantly and never waits on the network.
//
// Sized for three BLE sensors at 50 Hz, i.e. about 150 rows a second: a flush starts once 150 rows are queued or
// every second, whichever comes first, and one RPC carries at most 600 rows, so a backlog drains in bounded
// requests instead of one oversized call. Memory holds 45 000 rows, five minutes of outage at that rate; beyond
// it the oldest rows are dropped and counted in `framesDropped`, never silently.
//
// Durability, in four layers:
//  - stop() drains the queue (several RPCs if a backlog built up) and retries failed requests with backoff for up
//    to ten seconds, including the wait on a request that has not answered.
//  - Transient RPC failures re-queue the batch instead of dropping it.
//  - DurableQueue mirrors everything still unacknowledged (queued + in flight) into IndexedDB. start() recovers a
//    record a previous instance left for the same session (crash, unclean reload). The mirror is a whole-array
//    rewrite, so it is throttled to at most about once a second (plus a forced write on stop and on page hide)
//    rather than on every push, which at 150 pushes a second would rewrite a growing array quadratically. The
//    price is a loss window: a crash can lose up to about one second of rows pushed since the last write.
//  - Whatever a stop could not deliver stays in that record, and the outbox (outbox.ts) sends it later: on app
//    load, when the browser comes back online, and every 30 s while rows remain. A live buffer marks its session
//    active (outboxRegistry.ts) so the outbox leaves its record alone until stop() has written it.
// Rows resent by any of these paths are harmless thanks to the RPC's idempotency.
//
// Counting. `framesConfirmed` counts rows a flush RPC answered for successfully, minus rows it reported as skipped
// (recorded after the session ended, see 0034): each such row is in session_frames, inserted by that request or
// already stored by an earlier one whose answer never arrived. A row carried only by a keepalive request is not
// confirmed, because that response is never read; those rows are counted separately in `framesKeepaliveSent` and
// stay queued until a flush confirms them. Skipped rows are delivered (no longer pending) but not confirmed.
//
// On page hide or unload a best-effort keepalive request also sends the oldest queued rows. Browsers cap a
// keepalive body at 64 KiB, so the batch is trimmed to fit; the rows stay queued (hidden is not always gone),
// and a later flush that resends them is a no-op in Postgres.

import { createClient } from "@/lib/supabase/client";

import { DurableQueue } from "./durableQueue";
import { markSessionActive, notifyOutbox } from "./outboxRegistry";

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
  /** The older name of `framesConfirmed`, kept for the camera session screen. Always equal to it. */
  framesSent: number;
  eventsSent: number;
  /** Rows not yet acknowledged by Postgres: queued plus in flight. */
  pending: number;
  errors: number;
  lastError: string | null;
  /** Oldest rows discarded after the in-memory cap was hit. Always set by TelemetryBuffer. */
  framesDropped?: number;
  /** Rows a successful flush RPC acknowledged as stored (see the header). Always set by TelemetryBuffer. */
  framesConfirmed?: number;
  /** Rows the RPC acknowledged but did not store: recorded after the session ended. Always set by TelemetryBuffer. */
  framesSkipped?: number;
  /** Distinct rows handed to a keepalive request, whose answer is never read. Always set by TelemetryBuffer. */
  framesKeepaliveSent?: number;
}

export type TelemetryCounters = Required<BufferCounters>;

export const FLUSH_FRAMES = 150; // flush once this many rows are queued…
export const FLUSH_MS = 1000; // …or this often, whichever comes first
export const MAX_BATCH_FRAMES = 600; // rows per RPC; a backlog drains over several calls
export const MAX_BUFFER = 45_000; // five minutes at 150 rows/s before the oldest rows are dropped
export const PERSIST_MS = 1000; // at most one durable rewrite per interval
export const EMIT_MS = 250; // counter updates to the UI while rows stream in
export const KEEPALIVE_MAX_BYTES = 60_000; // under the 64 KiB keepalive body cap
export const STOP_DELIVERY_BUDGET_MS = 10_000; // how long stop() keeps trying before leaving rows to the outbox
export const STOP_RETRY_DELAYS_MS = [500, 1000, 2000, 4000] as const; // waits after consecutive failures in stop()

const OVERFLOW_SLACK = 1_500; // trim in bulk, not one splice per push, once over the cap

export type AuthCtx = { url: string; key: string; token: string; userId?: string };

export type FlushRpcArgs = { p_session: string; p_frames: FrameRow[]; p_events: FogEventRow[] };

export type FlushRpcError = { message?: string; code?: string };

export type FlushRpc = (args: FlushRpcArgs) => Promise<{ data: unknown; error: FlushRpcError | null }>;

export interface StopOptions {
  /** Time allowed for delivery before the rest is left in IndexedDB for the outbox. */
  budgetMs?: number;
}

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
  private recoveredOwner: string | null = null;
  private stopped = false;
  private releaseActive: (() => void) | null = null;
  private readonly keepaliveRows = new WeakSet<FrameRow>();
  readonly counters: TelemetryCounters = {
    framesSent: 0,
    eventsSent: 0,
    pending: 0,
    errors: 0,
    lastError: null,
    framesDropped: 0,
    framesConfirmed: 0,
    framesSkipped: 0,
    framesKeepaliveSent: 0,
  };

  constructor(
    private readonly sessionId: string,
    private readonly onUpdate?: (c: TelemetryCounters) => void,
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
    this.stopped = false;
    this.releaseActive ??= markSessionActive(this.sessionId);
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
      // Once stopped, stop() drives the remaining rounds itself.
      if (delivered && !this.stopped && this.frames.length >= FLUSH_FRAMES) void this.flush();
    });
    return this.flushing;
  }

  /**
   * Stop the loop and detach the unload net, then try to deliver everything still undelivered for up to
   * `budgetMs` (ten seconds by default), retrying failures with backoff. Whatever is left is written to IndexedDB,
   * where the outbox picks it up. Resolves once that record is current; `counters.pending` then says how many rows
   * were left.
   */
  async stop({ budgetMs = STOP_DELIVERY_BUDGET_MS }: StopOptions = {}): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.onUnload);
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    const deadline = Date.now() + budgetMs;
    let failures = 0;
    while (this.undelivered() > 0) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const errorsBefore = this.counters.errors;
      const answered = await withTimeout(
        this.flush().then(() => true),
        left,
        false,
      );
      if (!answered) break; // a request is still out; its rows stay in the durable record
      if (this.counters.errors > errorsBefore) {
        const delay = Math.min(
          STOP_RETRY_DELAYS_MS[Math.min(failures, STOP_RETRY_DELAYS_MS.length - 1)],
          deadline - Date.now(),
        );
        failures += 1;
        if (delay <= 0) break;
        await sleep(delay);
      }
    }
    await this.persistNow();
    this.releaseActive?.();
    this.releaseActive = null;
    if (this.undelivered() > 0) notifyOutbox();
  }

  private undelivered(): number {
    return this.inFlightFrames.length + this.frames.length + this.inFlightEvents.length + this.events.length;
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
      const skipped = skippedCounts(data, this.inFlightFrames.length, this.inFlightEvents.length);
      this.counters.framesConfirmed += this.inFlightFrames.length - skipped.frames;
      this.counters.framesSent = this.counters.framesConfirmed;
      this.counters.framesSkipped += skipped.frames;
      this.counters.eventsSent += this.inFlightEvents.length - skipped.events;
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
    const batch = keepaliveBatch(this.sessionId, this.frames, this.events);
    if (!batch) return;
    try {
      void fetch(`${auth.url}/rest/v1/rpc/flush_session_telemetry_batch`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          apikey: auth.key,
          Authorization: `Bearer ${auth.token}`,
        },
        body: batch.body,
      }).catch(() => undefined);
      for (let i = 0; i < batch.frameCount; i += 1) {
        const row = this.frames[i];
        if (this.keepaliveRows.has(row)) continue;
        this.keepaliveRows.add(row);
        this.counters.framesKeepaliveSent += 1;
      }
    } catch {
      /* best-effort — the awaited stop(), the durable record and the outbox are the guarantees */
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
        else {
          await this.durable.save(this.sessionId, frames, events, {
            ownerId: this.auth?.userId ?? this.recoveredOwner,
          });
        }
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
    this.recoveredOwner = saved.ownerId ?? null;
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
    this.counters.pending = this.undelivered();
    const now = Date.now();
    if (!force && now - this.lastEmitAt < EMIT_MS) return;
    this.lastEmitAt = now;
    this.onUpdate?.({ ...this.counters });
  }
}

/**
 * How many rows of a batch the flush RPC reported as skipped because they were recorded after the session ended.
 * 0034 answers `{ skipped: <frames>, skipped_events: <events> }`. Also accepts `skipped` alone as one number
 * (frames first) or as `{frames, events}`; anything else counts as none.
 */
export function skippedCounts(data: unknown, frames: number, events: number): { frames: number; events: number } {
  const answer = data && typeof data === "object" ? (data as { skipped?: unknown; skipped_events?: unknown }) : {};
  const skipped = answer.skipped;
  if (typeof skipped === "number" && answer.skipped_events !== undefined) {
    return { frames: clampCount(skipped, frames), events: clampCount(answer.skipped_events, events) };
  }
  if (typeof skipped === "number") {
    const skippedFrames = clampCount(skipped, frames);
    return { frames: skippedFrames, events: clampCount(skipped - skippedFrames, events) };
  }
  if (skipped && typeof skipped === "object") {
    const parts = skipped as { frames?: unknown; events?: unknown };
    return { frames: clampCount(parts.frames, frames), events: clampCount(parts.events, events) };
  }
  return { frames: 0, events: 0 };
}

/**
 * The JSON body for a keepalive flush: every event plus as many of the oldest frames as fit in `maxBytes`
 * (halving until it fits), with the number of frames it carries. Null when not even the events alone fit.
 */
export function keepaliveBatch(
  sessionId: string,
  frames: readonly FrameRow[],
  events: readonly FogEventRow[],
  maxBytes: number = KEEPALIVE_MAX_BYTES,
): { body: string; frameCount: number } | null {
  const encoder = new TextEncoder();
  let count = frames.length;
  for (;;) {
    const body = JSON.stringify({ p_session: sessionId, p_frames: frames.slice(0, count), p_events: events });
    if (encoder.encode(body).length <= maxBytes) return { body, frameCount: count };
    if (count === 0) return null;
    count = Math.floor(count / 2);
  }
}

/** The body alone, see keepaliveBatch. */
export function keepaliveBody(
  sessionId: string,
  frames: readonly FrameRow[],
  events: readonly FogEventRow[],
  maxBytes: number = KEEPALIVE_MAX_BYTES,
): string | null {
  return keepaliveBatch(sessionId, frames, events, maxBytes)?.body ?? null;
}

/** Resolves with the promise's value, or with `fallback` once `ms` pass first. A rejection counts as settling. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sessionAuth(supabase: ReturnType<typeof createClient>): Promise<AuthCtx | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return token && url && key ? { url, key, token, userId: data.session?.user?.id } : null;
}

function clampCount(value: unknown, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
}

export function errMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message ?? err);
  }
  return String(err);
}
