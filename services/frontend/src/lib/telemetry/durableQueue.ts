// Browser-side durable queue for TelemetryBuffer -- the write-ahead half of Phoenix's
// DurableBuffer (append-only JSONL + atomic replace, on the Python gateway side) translated
// to IndexedDB, since the browser has no filesystem to append to.
//
// One record per session, always overwritten wholesale (`put`, not append) to reflect
// exactly what TelemetryBuffer still considers undelivered -- queued *and* in-flight. That
// mirrors Phoenix's `replace()`: never a partial rewrite, just "here is the current true set
// of what hasn't been acknowledged yet." A reload or crash mid-outage can then recover the
// whole set on the next `start()`; a duplicate resend of an already-delivered batch is safe
// because `flush_session_telemetry_batch` is idempotent on (session_id, recorded_at, seq).

import type { FogEventRow, FrameRow } from "./buffer";

const DB_NAME = "mova-telemetry";
const DB_VERSION = 1;
const STORE_NAME = "pending";

export interface PendingBatch {
  sessionId: string;
  frames: FrameRow[];
  events: FogEventRow[];
  savedAt: string;
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

/** Best-effort durability: every method swallows failure (private browsing, denied storage
 * quota, no IndexedDB support) so a browser that can't durably queue still works exactly as
 * it did before this existed -- the in-memory bounded re-queue remains the primary guarantee. */
export class DurableQueue {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /** `dbName` is only overridden by tests, to give each one an isolated database. */
  constructor(private readonly dbName: string = DB_NAME) {}

  private db(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
    if (!this.dbPromise) this.dbPromise = openDb(this.dbName);
    return this.dbPromise;
  }

  async save(sessionId: string, frames: FrameRow[], events: FogEventRow[]): Promise<void> {
    try {
      const db = await this.db();
      const batch: PendingBatch = { sessionId, frames, events, savedAt: new Date().toISOString() };
      await runTx(db, (store) => store.put(batch));
    } catch {
      /* best-effort */
    }
  }

  async load(sessionId: string): Promise<PendingBatch | null> {
    try {
      const db = await this.db();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).get(sessionId);
        request.onsuccess = () => resolve((request.result as PendingBatch | undefined) ?? null);
        request.onerror = () => reject(request.error as unknown);
      });
    } catch {
      return null;
    }
  }

  async clear(sessionId: string): Promise<void> {
    try {
      const db = await this.db();
      await runTx(db, (store) => store.delete(sessionId));
    } catch {
      /* best-effort */
    }
  }
}
