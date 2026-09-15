// Browser-side durable queue for TelemetryBuffer -- the write-ahead half of Phoenix's
// DurableBuffer (append-only JSONL + atomic replace, on the Python gateway side) translated
// to IndexedDB, since the browser has no filesystem to append to.
//
// One record per session. A live buffer overwrites its record wholesale (`put`, not append)
// to reflect exactly what it still considers undelivered -- queued *and* in-flight. That
// mirrors Phoenix's `replace()`: never a partial rewrite, just "here is the current true set
// of what hasn't been acknowledged yet." A reload or crash mid-outage can then recover the
// whole set on the next `start()`, and the outbox (outbox.ts) delivers what a stopped buffer
// left behind; a duplicate resend of an already-delivered batch is safe because
// `flush_session_telemetry_batch` is idempotent on (session_id, recorded_at, seq).
//
// The outbox never overwrites a record. It settles: one readwrite transaction re-reads the
// record and removes only the rows the server acknowledged, so rows a recording wrote in the
// meantime, in this tab or another, stay. Where the browser has no Web Locks, the record also
// carries a lease naming who holds it (recordOwnership.ts); a settle or claim that finds
// someone else's current lease leaves the record alone.

import type { FogEventRow, FrameRow } from "./buffer";

const DB_NAME = "mova-telemetry";
const DB_VERSION = 1;
const STORE_NAME = "pending";

/** Why the server refused a record outright (for example the session no longer exists for this account). */
export interface RejectedMark {
  code: string | null;
  message: string;
  atMs: number;
  /** The page load whose outbox stored the mark. An outbox in any later page load tries the record once more. */
  pageLoadId?: string | null;
  /** The sign-in (auth session id) the refusal came under. A later sign-in tries the record once more. */
  signInId?: string | null;
}

/** Who holds a record where the browser has no Web Locks (recordOwnership.ts). */
export interface RecordLease {
  /** A live recording or an outbox delivery, unique per page load. */
  owner: string;
  kind: "recording" | "delivery";
  /** Epoch ms after which the lease no longer counts: its holder stopped renewing it (closed tab, crash). */
  expiresAtMs: number;
}

export interface PendingBatch {
  sessionId: string;
  frames: FrameRow[];
  events: FogEventRow[];
  savedAt: string;
  /** The signed-in user whose buffer wrote the record, when it was known. The outbox leaves other users' records alone. */
  ownerId?: string | null;
  /** Set by the outbox when the server refused the rows with a non-retryable error. The rows are kept, not deleted. */
  rejected?: RejectedMark | null;
  /** The record's current holder where Web Locks are unavailable. Never set under Web Locks. */
  lease?: RecordLease | null;
}

export interface SaveMeta {
  ownerId?: string | null;
  rejected?: RejectedMark | null;
  lease?: RecordLease | null;
}

export interface SettleRequest {
  /** frameKey() of every frame the server acknowledged since the previous settle. */
  deliveredFrames: readonly string[];
  /** eventKey() of every event the server acknowledged since the previous settle. */
  deliveredEvents: readonly string[];
  /** The settling delivery's lease owner (lease fallback), or null under Web Locks. Anyone else's current lease stops the write. */
  owner: string | null;
  /** The lease to leave on the record: a renewed delivery lease, or null to drop it. Undefined keeps the stored one. */
  lease?: RecordLease | null;
  /** A rejection mark to store, or null to remove the stored one. Undefined keeps the stored one. */
  rejected?: RejectedMark | null;
  nowMs: number;
}

/**
 * saved: rows remain (the record was rewritten, or needed no change); cleared: nothing was left, so the record was
 * deleted; missing: there is no record; taken: someone else's current lease is on the record, so it was not touched.
 */
export type SettleOutcome = "saved" | "cleared" | "missing" | "taken";

export type ClaimResult = { status: "claimed"; record: PendingBatch } | { status: "held" } | { status: "missing" };

/** A frame's identity: the RPC's idempotency key within a session. */
export function frameKey(frame: Pick<FrameRow, "recorded_at" | "seq">): string {
  return `${frame.recorded_at}|${frame.seq}`;
}

/** An event's identity: all of its fields (events have no sequence number). */
export function eventKey(event: FogEventRow): string {
  return JSON.stringify([
    event.kind,
    event.started_at,
    event.ended_at,
    event.confidence,
    event.freeze_index,
    event.source,
  ]);
}

/** True when `lease` belongs to someone other than `owner` and has not expired at `nowMs`. */
export function heldByOther(lease: RecordLease | null | undefined, owner: string | null, nowMs: number): boolean {
  return lease != null && lease.owner !== owner && lease.expiresAtMs > nowMs;
}

/** What a settle does to a stored record. `next` is the same object when nothing changes. Pure; see DurableQueue.settle. */
export function settleRecord(
  record: PendingBatch | null,
  request: SettleRequest,
): { outcome: SettleOutcome; next: PendingBatch | null } {
  if (!record) return { outcome: "missing", next: null };
  if (heldByOther(record.lease, request.owner, request.nowMs)) return { outcome: "taken", next: record };
  const deliveredFrames = new Set(request.deliveredFrames);
  const deliveredEvents = new Set(request.deliveredEvents);
  const frames =
    deliveredFrames.size > 0 ? record.frames.filter((frame) => !deliveredFrames.has(frameKey(frame))) : record.frames;
  const events =
    deliveredEvents.size > 0 ? record.events.filter((event) => !deliveredEvents.has(eventKey(event))) : record.events;
  if (frames.length === 0 && events.length === 0) return { outcome: "cleared", next: null };
  // Dropping a lease or a mark the record does not have changes nothing.
  const leaseChanges = request.lease !== undefined && !(request.lease === null && record.lease == null);
  const markChanges = request.rejected !== undefined && !(request.rejected === null && record.rejected == null);
  const unchanged =
    frames.length === record.frames.length && events.length === record.events.length && !leaseChanges && !markChanges;
  if (unchanged) return { outcome: "saved", next: record };
  const next: PendingBatch = { ...record, frames, events, savedAt: new Date(request.nowMs).toISOString() };
  setOptional(next, "lease", request.lease);
  setOptional(next, "rejected", request.rejected);
  return { outcome: "saved", next };
}

/** What a delivery claim does to a stored record (lease fallback). Pure; see DurableQueue.claim. */
export function claimRecord(
  record: PendingBatch | null,
  lease: RecordLease,
  nowMs: number,
): { result: ClaimResult; next: PendingBatch | null } {
  if (!record) return { result: { status: "missing" }, next: null };
  if (heldByOther(record.lease, lease.owner, nowMs)) return { result: { status: "held" }, next: null };
  const next: PendingBatch = { ...record, lease };
  return { result: { status: "claimed", record: next }, next };
}

function setOptional<K extends "lease" | "rejected">(record: PendingBatch, key: K, value: PendingBatch[K] | undefined) {
  if (value === undefined) return;
  if (value === null) delete record[key];
  else record[key] = value;
}

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "sessionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error as unknown);
  });
}

function runTx(db: IDBDatabase, run: (store: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    run(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error as unknown);
    tx.onabort = () => reject(tx.error as unknown);
  });
}

function readRequest<T>(db: IDBDatabase, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error as unknown);
  });
}

type RecordDecision<T> = { value: T; put?: PendingBatch; remove?: boolean };

/** Reads one record and writes the decision about it in the same readwrite transaction, so nothing lands in between. */
function updateRecord<T>(
  db: IDBDatabase,
  sessionId: string,
  decide: (record: PendingBatch | null) => RecordDecision<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    let decision: RecordDecision<T> | null = null;
    const get = store.get(sessionId);
    get.onsuccess = () => {
      decision = decide((get.result as PendingBatch | undefined) ?? null);
      if (decision.put) store.put(decision.put);
      else if (decision.remove) store.delete(sessionId);
    };
    tx.oncomplete = () => {
      if (decision) resolve(decision.value);
      else reject(new Error("IndexedDB transaction completed without reading the record"));
    };
    tx.onerror = () => reject(tx.error as unknown);
    tx.onabort = () => reject(tx.error as unknown);
  });
}

/** Best-effort durability: save/load/clear/stampLease swallow failure (private browsing, denied
 * storage quota, no IndexedDB support) so a browser that can't durably queue still works exactly
 * as it did before this existed -- the in-memory bounded re-queue remains the primary guarantee.
 * `read`, `listSessionIds`, `settle` and `claim` reject instead, so a caller that reports a count
 * can say "unknown" rather than "nothing stored". */
export class DurableQueue {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /** `dbName` is only overridden by tests, to give each one an isolated database. */
  constructor(private readonly dbName: string = DB_NAME) {}

  private db(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
    if (!this.dbPromise) {
      // A failed open is not cached, so a transient failure does not disable the queue for the page's lifetime.
      this.dbPromise = openDb(this.dbName).catch((err: unknown) => {
        this.dbPromise = null;
        throw err;
      });
    }
    return this.dbPromise;
  }

  async save(sessionId: string, frames: FrameRow[], events: FogEventRow[], meta: SaveMeta = {}): Promise<void> {
    try {
      const db = await this.db();
      const batch: PendingBatch = { sessionId, frames, events, savedAt: new Date().toISOString() };
      if (meta.ownerId) batch.ownerId = meta.ownerId;
      if (meta.rejected) batch.rejected = meta.rejected;
      if (meta.lease) batch.lease = meta.lease;
      await runTx(db, (store) => store.put(batch));
    } catch {
      /* best-effort */
    }
  }

  async load(sessionId: string): Promise<PendingBatch | null> {
    try {
      return await this.read(sessionId);
    } catch {
      return null;
    }
  }

  /** The stored record, or null when there is none. Rejects when IndexedDB cannot be read. */
  async read(sessionId: string): Promise<PendingBatch | null> {
    const db = await this.db();
    const result = await readRequest<PendingBatch | undefined>(db, (store) => store.get(sessionId));
    return result ?? null;
  }

  /** Every session that has a stored record. Rejects when IndexedDB cannot be read. */
  async listSessionIds(): Promise<string[]> {
    const db = await this.db();
    const keys = await readRequest<IDBValidKey[]>(db, (store) => store.getAllKeys());
    return keys.filter((key): key is string => typeof key === "string");
  }

  async clear(sessionId: string): Promise<void> {
    try {
      const db = await this.db();
      await runTx(db, (store) => store.delete(sessionId));
    } catch {
      /* best-effort */
    }
  }

  /**
   * Removes delivered rows from the record as it is now, in one transaction (see settleRecord): rows written since
   * the caller read the record stay, the record is deleted only when nothing is left, and a record under someone
   * else's current lease is not touched. Rejects when IndexedDB cannot be written.
   */
  async settle(sessionId: string, request: SettleRequest): Promise<SettleOutcome> {
    const db = await this.db();
    return updateRecord(db, sessionId, (record) => {
      const { outcome, next } = settleRecord(record, request);
      if (outcome === "cleared") return { value: outcome, remove: true };
      if (outcome === "saved" && next && next !== record) return { value: outcome, put: next };
      return { value: outcome };
    });
  }

  /**
   * Takes the record for a delivery under `lease` (lease fallback), unless someone else's current lease is on it.
   * Returns the record as claimed. Rejects when IndexedDB cannot be written.
   */
  async claim(sessionId: string, lease: RecordLease, nowMs: number = Date.now()): Promise<ClaimResult> {
    const db = await this.db();
    return updateRecord(db, sessionId, (record) => {
      const { result, next } = claimRecord(record, lease, nowMs);
      return next ? { value: result, put: next } : { value: result };
    });
  }

  /** Puts `lease` on the stored record (null removes it), whoever holds it now. Does nothing when there is no record. */
  async stampLease(sessionId: string, lease: RecordLease | null): Promise<void> {
    try {
      const db = await this.db();
      await updateRecord<void>(db, sessionId, (record) => {
        if (!record) return { value: undefined };
        const next: PendingBatch = { ...record };
        setOptional(next, "lease", lease);
        return { value: undefined, put: next };
      });
    } catch {
      /* best-effort */
    }
  }
}
