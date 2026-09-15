"use client";

// Telemetry outbox — delivers the rows a stopped TelemetryBuffer left in IndexedDB.
//
// TelemetryBuffer.stop() keeps trying for about ten seconds, then leaves whatever it could not deliver in its
// session's `mova-telemetry` record. Once the session is finished no buffer for it ever starts again, so without
// this those rows would stay on the device for good. The outbox sends every stored record through the same
// flush_session_telemetry_batch RPC, which is idempotent on (session_id, recorded_at, seq) and accepts rows of a
// finished session that were recorded before it ended.
//
// Rules:
//  - One run at a time; concurrent drain() calls share it. When a buffer stops with rows left while a run is
//    going, the run takes another pass (up to three) so those rows are not missed.
//  - A session a live buffer in this tab owns is skipped, and a record a buffer takes over mid-run is no longer
//    written back: the buffer recovered it on start and owns it now.
//  - A record written under another account is left alone.
//  - Each batch gets three attempts (1 s, then 3 s apart), each bounded by a 20 s timeout. When a batch still
//    fails, the run stops (most likely the network is down) and reports what remains for the next run.
//  - A successful answer that reports skipped rows (recorded after the session ended, 0034) counts as delivered.
//  - A non-retryable refusal (42501 ownership, class 22 data or class 23 integrity errors) on a record written
//    under this account marks it rejected: kept in IndexedDB, never deleted, not retried, and reported as
//    `rejected` rather than `remaining`.
//  - Progress is written back at most once a second and when a record is done, not after every batch: a crash
//    mid-run only means resending rows the server already has.

import { createClient } from "@/lib/supabase/client";

import {
  MAX_BATCH_FRAMES,
  errMessage,
  sleep as defaultSleep,
  withTimeout,
  type FlushRpc,
  type FlushRpcError,
  type FogEventRow,
  type FrameRow,
} from "./buffer";
import { DurableQueue, type PendingBatch, type RejectedMark } from "./durableQueue";
import { isSessionActive as defaultIsSessionActive, outboxVersion } from "./outboxRegistry";

export const OUTBOX_ATTEMPTS = 3;
export const OUTBOX_RETRY_DELAYS_MS = [1000, 3000] as const;
export const OUTBOX_REQUEST_TIMEOUT_MS = 20_000;
export const OUTBOX_WRITE_BACK_MS = 1000;
const MAX_PASSES = 3;

export interface OutboxDrainResult {
  /** Sessions this run tried to deliver stored rows for. */
  sessions: number;
  /** Rows (frames and events) the server acknowledged during this run, including rows it reported as skipped. */
  sent: number;
  /** Rows still stored on this device for the signed-in account (all accounts when nobody is signed in). */
  remaining: number;
  /** Rows the server refused outright. They stay on the device and are not retried. */
  rejected: number;
}

export type OutboxStore = Pick<DurableQueue, "listSessionIds" | "read" | "save" | "clear">;

/** Test seams. Production uses the browser Supabase client and IndexedDB. */
export interface TelemetryOutboxDeps {
  rpc?: FlushRpc;
  store?: OutboxStore;
  getUserId?: () => Promise<string | null>;
  isSessionActive?: (sessionId: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export interface TelemetryOutbox {
  /** Deliver every stored record. Rejects only when IndexedDB cannot be read. */
  drain(): Promise<OutboxDrainResult>;
  /**
   * Rows stored for this session and not yet delivered, as of the last durable write (a live buffer rewrites its
   * record about once a second). Rejects when IndexedDB cannot be read, so a caller can record "unknown" rather
   * than 0.
   */
  pendingForSession(sessionId: string): Promise<number>;
}

type SendOutcome = { kind: "ok" } | { kind: "rejected"; mark: RejectedMark } | { kind: "failed" };
type RecordOutcome = { sent: number; remaining: number; rejected: number; halt: boolean };
type RpcAnswer = Awaited<ReturnType<FlushRpc>>;

export function createTelemetryOutbox(deps: TelemetryOutboxDeps = {}): TelemetryOutbox {
  let client: ReturnType<typeof createClient> | null = null;
  const supabase = () => (client ??= createClient());
  const rpc: FlushRpc = deps.rpc ?? (async (args) => supabase().rpc("flush_session_telemetry_batch", args));
  const store: OutboxStore = deps.store ?? new DurableQueue();
  const getUserId =
    deps.getUserId ??
    (async () => {
      const { data } = await supabase().auth.getSession();
      return data.session?.user?.id ?? null;
    });
  const isActive = deps.isSessionActive ?? defaultIsSessionActive;
  const wait = deps.sleep ?? defaultSleep;
  let running: Promise<OutboxDrainResult> | null = null;

  async function send(sessionId: string, frames: FrameRow[], events: FogEventRow[]): Promise<SendOutcome> {
    for (let attempt = 0; attempt < OUTBOX_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await wait(OUTBOX_RETRY_DELAYS_MS[Math.min(attempt - 1, OUTBOX_RETRY_DELAYS_MS.length - 1)]);
      }
      const request: Promise<RpcAnswer> = Promise.resolve()
        .then(() => rpc({ p_session: sessionId, p_frames: frames, p_events: events }))
        .catch((err: unknown) => ({ data: null, error: { message: errMessage(err) } }));
      // No answer in time counts as a transient failure. The request may still land, which the RPC tolerates.
      const answer = await withTimeout<RpcAnswer | null>(request, OUTBOX_REQUEST_TIMEOUT_MS, null);
      if (!answer) continue;
      if (!answer.error) return { kind: "ok" };
      if (isNonRetryable(answer.error)) {
        return {
          kind: "rejected",
          mark: { code: answer.error.code ?? null, message: errMessage(answer.error), atMs: Date.now() },
        };
      }
    }
    return { kind: "failed" };
  }

  async function deliverRecord(record: PendingBatch, userId: string): Promise<RecordOutcome> {
    const { sessionId } = record;
    const ownerId = record.ownerId ?? null;
    let frames = record.frames;
    let events = record.events;
    let sent = 0;
    let dirty = false;
    let lastWriteAt = Date.now();

    // False when a buffer in this tab has taken the session over since the run started.
    const writeBack = async (rejected: RejectedMark | null = null): Promise<boolean> => {
      if (isActive(sessionId)) return false;
      if (frames.length === 0 && events.length === 0) await store.clear(sessionId);
      else await store.save(sessionId, frames, events, { ownerId, rejected });
      dirty = false;
      lastWriteAt = Date.now();
      return true;
    };

    while (frames.length > 0 || events.length > 0) {
      if (isActive(sessionId)) return { sent, remaining: 0, rejected: 0, halt: false };
      const batch = frames.slice(0, MAX_BATCH_FRAMES);
      const outcome = await send(sessionId, batch, events);
      if (outcome.kind === "failed") {
        if (dirty) await writeBack();
        return { sent, remaining: frames.length + events.length, rejected: 0, halt: true };
      }
      if (outcome.kind === "rejected") {
        const left = frames.length + events.length;
        // Only a record written under this account is marked. A refusal of a record of unknown origin most likely
        // means it belongs to another account, which may still deliver it.
        if (ownerId !== null && ownerId === userId) await writeBack(outcome.mark);
        else if (dirty) await writeBack();
        return { sent, remaining: 0, rejected: left, halt: false };
      }
      sent += batch.length + events.length;
      frames = frames.slice(batch.length);
      events = [];
      dirty = true;
      if (frames.length === 0 || Date.now() - lastWriteAt >= OUTBOX_WRITE_BACK_MS) {
        if (!(await writeBack())) return { sent, remaining: 0, rejected: 0, halt: false };
      }
    }
    return { sent, remaining: 0, rejected: 0, halt: false };
  }

  async function pass(userId: string | null, attempted: Set<string>) {
    const result = { sent: 0, remaining: 0, rejected: 0, halted: userId === null };
    for (const sessionId of await store.listSessionIds()) {
      if (isActive(sessionId)) continue;
      const record = await store.read(sessionId);
      if (!record) continue;
      const size = record.frames.length + record.events.length;
      if (size === 0) {
        await store.clear(sessionId);
        continue;
      }
      if (userId !== null && record.ownerId && record.ownerId !== userId) continue;
      if (record.rejected) {
        result.rejected += size;
        continue;
      }
      if (result.halted || userId === null) {
        result.remaining += size;
        continue;
      }
      attempted.add(sessionId);
      const outcome = await deliverRecord(record, userId);
      result.sent += outcome.sent;
      result.remaining += outcome.remaining;
      result.rejected += outcome.rejected;
      if (outcome.halt) result.halted = true;
    }
    return result;
  }

  async function run(): Promise<OutboxDrainResult> {
    const userId = await getUserId().catch(() => null);
    const attempted = new Set<string>();
    let sent = 0;
    let last = { remaining: 0, rejected: 0 };
    for (let index = 0; index < MAX_PASSES; index += 1) {
      const version = outboxVersion();
      const result = await pass(userId, attempted);
      sent += result.sent;
      last = result;
      if (result.halted || outboxVersion() === version) break;
    }
    return { sessions: attempted.size, sent, remaining: last.remaining, rejected: last.rejected };
  }

  return {
    drain() {
      running ??= run().finally(() => {
        running = null;
      });
      return running;
    },
    async pendingForSession(sessionId) {
      const record = await store.read(sessionId);
      return record ? record.frames.length + record.events.length : 0;
    },
  };
}

/** Errors that a resend cannot fix: ownership (42501), data exceptions (class 22), integrity violations (class 23). */
export function isNonRetryable(error: FlushRpcError): boolean {
  const code = error.code ?? "";
  return code === "42501" || /^2[23][0-9A-Z]{3}$/.test(code);
}

let shared: TelemetryOutbox | null = null;

function sharedOutbox(): TelemetryOutbox {
  return (shared ??= createTelemetryOutbox());
}

/** Deliver every session's stored rows. Concurrent calls share one run. Rejects only when IndexedDB cannot be read. */
export function drainTelemetryOutbox(): Promise<OutboxDrainResult> {
  return sharedOutbox().drain();
}

/** Undelivered rows stored for `sessionId`. Rejects when IndexedDB cannot be read (see TelemetryOutbox). */
export function pendingForSession(sessionId: string): Promise<number> {
  return sharedOutbox().pendingForSession(sessionId);
}
