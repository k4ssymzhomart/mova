// Browser-side durable queue for TelemetryBuffer -- the write-ahead half of Phoenix's
// DurableBuffer (append-only JSONL + atomic replace, on the Python gateway side) translated
// to IndexedDB, since the browser has no filesystem to append to.
//
// One record per session, always overwritten wholesale (`put`, not append) to reflect
// exactly what TelemetryBuffer still considers undelivered -- queued *and* in-flight. That
// mirrors Phoenix's `replace()`: never a partial rewrite, just "here is the current true set
// of what hasn't been acknowledged yet." A reload or crash mid-outage can then recover the
// whole set on the next `start()`, and the outbox (outbox.ts) delivers what a stopped buffer
// left behind; a duplicate resend of an already-delivered batch is safe because
// `flush_session_telemetry_batch` is idempotent on (session_id, recorded_at, seq).

import type { FogEventRow, FrameRow } from "./buffer";

const DB_NAME = "mova-telemetry";
const DB_VERSION = 1;
const STORE_NAME = "pending";

/** Why the server refused a record outright (for example the session no longer exists for this account). */
export interface RejectedMark {
  code: string | null;
  message: string;
  atMs: number;
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
}

export interface SaveMeta {
  ownerId?: string | null;
  rejected?: RejectedMark | null;
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

/** Best-effort durability: save/load/clear swallow failure (private browsing, denied storage
 * quota, no IndexedDB support) so a browser that can't durably queue still works exactly as
 * it did before this existed -- the in-memory bounded re-queue remains the primary guarantee.
 * `read` and `listSessionIds` reject instead, so a caller that reports a count can say
 * "unknown" rather than "nothing stored". */
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
}
