"use client";

// Telemetry outbox — delivers the rows a stopped TelemetryBuffer left in IndexedDB.
//
// TelemetryBuffer.stop() keeps trying for about ten seconds, then leaves whatever it could not deliver in its
// session's `mova-telemetry` record. Once the session is finished no buffer for it ever starts again, so without
// this those rows would stay on the device for good. The outbox sends every stored record through the same
// flush_session_telemetry_batch RPC, which is idempotent on (session_id, recorded_at, seq) and accepts rows of a
// finished session recorded up to two minutes after it ended.
//
// Rules:
//  - One run at a time per tab; concurrent drain() calls share it. When a buffer stops with rows left while a run is
//    going, the run takes another pass (up to three) so those rows are not missed.
//  - A session a live buffer in this tab owns is skipped. Across tabs a record has one holder at a time
//    (recordOwnership.ts): the outbox delivers a record only when it can take it without waiting, counts a record
//    somebody else holds as remaining, and gives a record back as soon as a recording asks for it.
//  - The outbox never rewrites a record wholesale. A write-back re-reads the record in the same IndexedDB transaction
//    and removes only the rows the server acknowledged (DurableQueue.settle), so rows a recording wrote meanwhile stay.
//  - A record written under another account is left alone.
//  - Each batch gets three attempts (1 s, then 3 s apart), each bounded by a 20 s timeout. When a batch still fails,
//    the run stops (most likely the network is down) and reports what remains for the next run.
//  - A 42501 refusal is retried three times (1, 4 and 10 s apart), each time after refreshing the auth session. If it
//    still comes back, the signed-in account is checked again: when it is gone or different, the request most likely
//    went out without this account's token, so the run stops and the rows wait.
//  - Otherwise a non-retryable refusal (42501, class 22 data or class 23 integrity errors) of a record written under
//    this account marks it rejected: kept in IndexedDB, not deleted, reported as `rejected`. A rejected record is
//    tried once more after the next app load and after the next sign-in, and marked again if it is refused again.
//  - Rows the server acknowledges but skips (recorded more than two minutes after their session ended, 0034) leave
//    the record like delivered rows, because resending them cannot store them. They are reported per session in the
//    result and added to the session's tally in IndexedDB (skippedTally.ts) once the write-back removing them landed.
//  - Progress is written back at most once a second and when a record is done, not after every batch: a crash mid-run
//    only means resending rows the server already has.

import { createClient } from "@/lib/supabase/client";

import {
  MAX_BATCH_FRAMES,
  errMessage,
  skippedCounts,
  sleep as defaultSleep,
  withTimeout,
  type FlushRpc,
  type FlushRpcError,
  type FogEventRow,
  type FrameRow,
} from "./buffer";
import {
  DurableQueue,
  eventKey,
  frameKey,
  type PendingBatch,
  type RejectedMark,
  type SettleOutcome,
} from "./durableQueue";
import { isSessionActive as defaultIsSessionActive, outboxVersion } from "./outboxRegistry";
import {
  browserLocks,
  deliverUnderOwnership,
  pageLoadId as currentPageLoadId,
  type DeliveryClaim,
  type LockManagerLike,
} from "./recordOwnership";
import { SkippedTally, type SkippedCounts, type SkippedTallyEntry } from "./skippedTally";

export const OUTBOX_ATTEMPTS = 3;
export const OUTBOX_RETRY_DELAYS_MS = [1000, 3000] as const;
export const OUTBOX_AUTH_RETRY_DELAYS_MS = [1000, 4000, 10_000] as const;
export const OUTBOX_REQUEST_TIMEOUT_MS = 20_000;
export const OUTBOX_WRITE_BACK_MS = 1000;
const MAX_PASSES = 3;

export interface OutboxDrainResult {
  /** Sessions this run tried to deliver stored rows for. */
  sessions: number;
  /** Rows (frames and events) the server acknowledged as stored during this run: inserted now or stored before. */
  sent: number;
  /** Rows the server acknowledged but did not store during this run. They are no longer on the device. */
  skipped: number;
  /** Per session, the rows skipped during this run because they were recorded more than two minutes after it ended. */
  skippedBySession: Record<string, SkippedCounts>;
  /**
   * Rows still stored on this device for the signed-in account (all accounts when nobody is signed in), including
   * records another tab holds at the moment.
   */
  remaining: number;
  /** Rows the server refused outright. They stay on the device and are tried again after the next app load or sign-in. */
  rejected: number;
}

export type OutboxStore = Pick<DurableQueue, "listSessionIds" | "read" | "settle" | "claim">;

export type OutboxTally = Pick<SkippedTally, "add" | "read">;

/** Test seams. Production uses the browser Supabase client, IndexedDB and the browser's Web Locks. */
export interface TelemetryOutboxDeps {
  rpc?: FlushRpc;
  store?: OutboxStore;
  getUserId?: () => Promise<string | null>;
  /** Identifies the current sign-in. A record rejected under a different one is tried once more. */
  getSignInId?: () => Promise<string | null>;
  /** Refreshes the auth session before a 42501 is retried. */
  refreshAuth?: () => Promise<void>;
  isSessionActive?: (sessionId: string) => boolean;
  /** Web Locks to coordinate tabs with, or null for leases stored on the records. Defaults to the browser's. */
  locks?: LockManagerLike | null;
  tally?: OutboxTally;
  /** Identifies the page load. A record rejected in a different one is tried once more. */
  pageLoadId?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
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
  /**
   * Rows the server reported as skipped for this session on this device (by the outbox or a live recording), or null
   * when none were. Rejects when IndexedDB cannot be read.
   */
  skippedForSession(sessionId: string): Promise<SkippedTallyEntry | null>;
}

type SendOutcome =
  | { kind: "ok"; skipped: SkippedCounts }
  | { kind: "refused"; auth: boolean; mark: RejectedMark }
  | { kind: "failed" };
type RecordOutcome = { sent: number; skipped: SkippedCounts; remaining: number; rejected: number; halt: boolean };
type RpcAnswer = Awaited<ReturnType<FlushRpc>>;
type Identity = { userId: string | null; signInId: string | null };
type Totals = { sent: number; skipped: number; bySession: Record<string, SkippedCounts> };

export function createTelemetryOutbox(deps: TelemetryOutboxDeps = {}): TelemetryOutbox {
  let client: ReturnType<typeof createClient> | null = null;
  const supabase = () => (client ??= createClient());
  const rpc: FlushRpc = deps.rpc ?? (async (args) => supabase().rpc("flush_session_telemetry_batch", args));
  const store: OutboxStore = deps.store ?? new DurableQueue();
  const tally: OutboxTally = deps.tally ?? new SkippedTally();
  const identity = async (): Promise<Identity> => {
    if (deps.getUserId) {
      const userId = await deps.getUserId();
      const signInId = deps.getSignInId ? await deps.getSignInId().catch(() => null) : null;
      return { userId, signInId };
    }
    const { data } = await supabase().auth.getSession();
    return { userId: data.session?.user?.id ?? null, signInId: signInIdOf(data.session?.access_token) };
  };
  // getSession() refreshes an access token that has expired, so a refresh that failed earlier is tried again.
  const refreshAuth =
    deps.refreshAuth ??
    (async () => {
      await supabase().auth.getSession();
    });
  const isActive = deps.isSessionActive ?? defaultIsSessionActive;
  const locks = deps.locks === undefined ? browserLocks() : deps.locks;
  const pageId = deps.pageLoadId ?? currentPageLoadId();
  const wait = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => Date.now());
  let running: Promise<OutboxDrainResult> | null = null;

  async function send(sessionId: string, frames: FrameRow[], events: FogEventRow[]): Promise<SendOutcome> {
    let failures = 0;
    let authRetries = 0;
    for (;;) {
      const request: Promise<RpcAnswer> = Promise.resolve()
        .then(() => rpc({ p_session: sessionId, p_frames: frames, p_events: events }))
        .catch((err: unknown) => ({ data: null, error: { message: errMessage(err) } }));
      // No answer in time counts as a transient failure. The request may still land, which the RPC tolerates.
      const answer = await withTimeout<RpcAnswer | null>(request, OUTBOX_REQUEST_TIMEOUT_MS, null);
      if (answer && !answer.error) {
        return { kind: "ok", skipped: skippedCounts(answer.data, frames.length, events.length) };
      }
      const error = answer?.error ?? null;
      if (error && isAuthRefusal(error) && authRetries < OUTBOX_AUTH_RETRY_DELAYS_MS.length) {
        // A request sent while the session could not be refreshed goes out with the anon key and gets 42501.
        await wait(OUTBOX_AUTH_RETRY_DELAYS_MS[authRetries]);
        authRetries += 1;
        await withTimeout(
          refreshAuth().then(() => true),
          OUTBOX_REQUEST_TIMEOUT_MS,
          false,
        );
        continue;
      }
      if (error && isNonRetryable(error)) {
        return {
          kind: "refused",
          auth: isAuthRefusal(error),
          mark: { code: error.code ?? null, message: errMessage(error), atMs: now() },
        };
      }
      failures += 1;
      if (failures >= OUTBOX_ATTEMPTS) return { kind: "failed" };
      await wait(OUTBOX_RETRY_DELAYS_MS[Math.min(failures - 1, OUTBOX_RETRY_DELAYS_MS.length - 1)]);
    }
  }

  // Drops this delivery's lease without delivering anything (lease fallback; nothing to drop under Web Locks).
  async function releaseClaim(sessionId: string, claim: DeliveryClaim): Promise<void> {
    if (claim.owner === null) return;
    await store.settle(sessionId, {
      deliveredFrames: [],
      deliveredEvents: [],
      owner: claim.owner,
      lease: null,
      nowMs: now(),
    });
  }

  async function deliverRecord(record: PendingBatch, who: Identity, claim: DeliveryClaim): Promise<RecordOutcome> {
    const { sessionId } = record;
    const ownerId = record.ownerId ?? null;
    let frames = record.frames;
    let events = record.events;
    let sent = 0;
    const skipped: SkippedCounts = { frames: 0, events: 0 };
    // Acknowledged since the last write-back; the next one removes them from the stored record.
    let doneFrames: string[] = [];
    let doneEvents: string[] = [];
    let doneSkipped: SkippedCounts = { frames: 0, events: 0 };
    // A rejected record whose retry got a successful answer is no longer rejected.
    let unmark = false;
    let lastWriteAt = now();
    const result = (remaining: number, rejected: number, halt: boolean): RecordOutcome => ({
      sent,
      skipped: { ...skipped },
      remaining,
      rejected,
      halt,
    });

    // Settles progress into the stored record. False when a recording holds the record now or it is gone, so the run
    // leaves it: the recording recovered those rows and delivers them itself.
    const writeBack = async (final: boolean, mark?: RejectedMark): Promise<boolean> => {
      if (isActive(sessionId)) return false;
      const progress = doneFrames.length > 0 || doneEvents.length > 0 || unmark || mark !== undefined;
      if (!progress && claim.owner === null) return true;
      let outcome: SettleOutcome | "failed";
      try {
        outcome = await store.settle(sessionId, {
          deliveredFrames: doneFrames,
          deliveredEvents: doneEvents,
          owner: claim.owner,
          lease: claim.owner === null ? undefined : final ? null : claim.lease(),
          rejected: mark ?? (unmark ? null : undefined),
          nowMs: now(),
        });
      } catch {
        outcome = "failed"; // nothing was written: the rows stay stored and are resent later
      }
      lastWriteAt = now();
      if (outcome === "failed") return true;
      if (outcome === "taken" || outcome === "missing") return false;
      const counted = doneSkipped;
      doneFrames = [];
      doneEvents = [];
      doneSkipped = { frames: 0, events: 0 };
      unmark = false;
      if (counted.frames + counted.events > 0) await tally.add(sessionId, counted).catch(() => undefined);
      return true;
    };

    while (frames.length > 0 || events.length > 0) {
      if (isActive(sessionId) || !(await claim.stillOwned())) return result(0, 0, false);
      const batch = frames.slice(0, MAX_BATCH_FRAMES);
      const batchEvents = events;
      const answer = await send(sessionId, batch, batchEvents);
      if (answer.kind === "failed") {
        await writeBack(true);
        return result(frames.length + events.length, 0, true);
      }
      if (answer.kind === "refused") {
        const left = frames.length + events.length;
        if (answer.auth) {
          const current = await identity().catch(() => null);
          if (!current?.userId || current.userId !== who.userId) {
            await writeBack(true);
            return result(left, 0, true);
          }
        }
        // Only a record written under this account is marked. A refusal of a record of unknown origin most likely
        // means it belongs to another account, which may still deliver it.
        const mark =
          ownerId !== null && ownerId === who.userId
            ? { ...answer.mark, pageLoadId: pageId, signInId: who.signInId }
            : undefined;
        await writeBack(true, mark);
        return result(0, left, false);
      }
      sent += batch.length - answer.skipped.frames + (batchEvents.length - answer.skipped.events);
      skipped.frames += answer.skipped.frames;
      skipped.events += answer.skipped.events;
      doneSkipped = {
        frames: doneSkipped.frames + answer.skipped.frames,
        events: doneSkipped.events + answer.skipped.events,
      };
      for (const frame of batch) doneFrames.push(frameKey(frame));
      for (const event of batchEvents) doneEvents.push(eventKey(event));
      if (record.rejected) unmark = true;
      frames = frames.slice(batch.length);
      events = [];
      const done = frames.length === 0;
      if (done || now() - lastWriteAt >= OUTBOX_WRITE_BACK_MS) {
        if (!(await writeBack(done)) && !done) return result(0, 0, false);
      }
    }
    return result(0, 0, false);
  }

  function planFor(record: PendingBatch, who: Identity): "deliver" | "rejected" | "other-account" {
    if (who.userId !== null && record.ownerId && record.ownerId !== who.userId) return "other-account";
    if (record.rejected && !shouldRetryRejected(record.rejected, pageId, who.signInId)) return "rejected";
    return "deliver";
  }

  async function pass(who: Identity, attempted: Set<string>, totals: Totals) {
    const outcome = { remaining: 0, rejected: 0, halted: who.userId === null };
    for (const sessionId of await store.listSessionIds()) {
      if (isActive(sessionId)) continue;
      const record = await store.read(sessionId);
      if (!record) continue;
      const size = sizeOf(record);
      if (size === 0) {
        // Deleted only if still empty inside the transaction: rows a recording wrote since the read stay.
        await store
          .settle(sessionId, { deliveredFrames: [], deliveredEvents: [], owner: null, nowMs: now() })
          .catch(() => undefined);
        continue;
      }
      const plan = planFor(record, who);
      if (plan === "other-account") continue;
      if (plan === "rejected") {
        outcome.rejected += size;
        continue;
      }
      if (outcome.halted) {
        outcome.remaining += size;
        continue;
      }
      const delivery = await deliverUnderOwnership(
        sessionId,
        { locks, now, store, pageLoadId: pageId, release: (claim) => releaseClaim(sessionId, claim) },
        async (fresh, claim): Promise<RecordOutcome> => {
          const freshPlan = sizeOf(fresh) === 0 ? "empty" : planFor(fresh, who);
          if (freshPlan !== "deliver") {
            await releaseClaim(sessionId, claim).catch(() => undefined);
            const rejected = freshPlan === "rejected" ? sizeOf(fresh) : 0;
            return { sent: 0, skipped: { frames: 0, events: 0 }, remaining: 0, rejected, halt: false };
          }
          attempted.add(sessionId);
          return deliverRecord(fresh, who, claim);
        },
      );
      if (delivery.status === "held") {
        outcome.remaining += size; // a recording or another tab's delivery has it now
        continue;
      }
      if (delivery.status === "missing") continue;
      totals.sent += delivery.value.sent;
      addSkipped(totals, sessionId, delivery.value.skipped);
      outcome.remaining += delivery.value.remaining;
      outcome.rejected += delivery.value.rejected;
      if (delivery.value.halt) outcome.halted = true;
    }
    return outcome;
  }

  async function run(): Promise<OutboxDrainResult> {
    const who = await identity().catch((): Identity => ({ userId: null, signInId: null }));
    const attempted = new Set<string>();
    const totals: Totals = { sent: 0, skipped: 0, bySession: {} };
    let last = { remaining: 0, rejected: 0 };
    for (let index = 0; index < MAX_PASSES; index += 1) {
      const version = outboxVersion();
      const result = await pass(who, attempted, totals);
      last = result;
      if (result.halted || outboxVersion() === version) break;
    }
    return {
      sessions: attempted.size,
      sent: totals.sent,
      skipped: totals.skipped,
      skippedBySession: totals.bySession,
      remaining: last.remaining,
      rejected: last.rejected,
    };
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
      return record ? sizeOf(record) : 0;
    },
    skippedForSession(sessionId) {
      return tally.read(sessionId);
    },
  };
}

function sizeOf(record: PendingBatch): number {
  return record.frames.length + record.events.length;
}

function addSkipped(totals: Totals, sessionId: string, counts: SkippedCounts): void {
  const total = counts.frames + counts.events;
  if (total === 0) return;
  const previous = totals.bySession[sessionId];
  totals.bySession[sessionId] = {
    frames: (previous?.frames ?? 0) + counts.frames,
    events: (previous?.events ?? 0) + counts.events,
  };
  totals.skipped += total;
}

/** Errors that a resend cannot fix: ownership (42501), data exceptions (class 22), integrity violations (class 23). */
export function isNonRetryable(error: FlushRpcError): boolean {
  const code = error.code ?? "";
  return code === "42501" || /^2[23][0-9A-Z]{3}$/.test(code);
}

/** A refusal that a request without this account's token also gets: retried after refreshing the session first. */
export function isAuthRefusal(error: FlushRpcError): boolean {
  return error.code === "42501";
}

/** A rejected record is tried once more in every page load, and under every sign-in, other than the refusal's own. */
export function shouldRetryRejected(mark: RejectedMark, pageLoadId: string, signInId: string | null): boolean {
  if ((mark.pageLoadId ?? null) !== pageLoadId) return true;
  return signInId !== null && (mark.signInId ?? null) !== signInId;
}

/** The auth session id (`session_id` claim) of an access token, or null. Used only to tell one sign-in from the next. */
export function signInIdOf(accessToken: string | null | undefined): string | null {
  const payload = accessToken?.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const claims = JSON.parse(atob(padded)) as { session_id?: unknown };
    return typeof claims.session_id === "string" && claims.session_id !== "" ? claims.session_id : null;
  } catch {
    return null;
  }
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

/** Rows the server reported as skipped for `sessionId` on this device, or null. Rejects when IndexedDB cannot be read. */
export function skippedForSession(sessionId: string): Promise<SkippedTallyEntry | null> {
  return sharedOutbox().skippedForSession(sessionId);
}
