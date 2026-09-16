// Rows the server acknowledged but did not store, counted per session on this device so the discard can be reported.
//
// flush_session_telemetry_batch skips the rows of a session that is no longer in progress when they were recorded more
// than two minutes after it ended (0034), and answers with how many frames and events it skipped. Such rows can never
// be stored, so they leave the pending record, and this tally is what remains of them. The outbox and a live
// TelemetryBuffer both add to it, each after the write that removes the rows from the pending record: a crash before
// that write means the rows are sent again and counted then, not twice. Counts only, for at most the 100 most recently
// updated sessions.
//
// It lives in a database of its own. A second store inside "mova-telemetry" would need a version upgrade, and an
// upgrade waits until every other open tab has closed its connection to that database.

const DB_NAME = "mova-telemetry-skipped";
const DB_VERSION = 1;
const STORE_NAME = "tally";

export const SKIPPED_TALLY_MAX_SESSIONS = 100;

export interface SkippedCounts {
  frames: number;
  events: number;
}

export interface SkippedTallyEntry extends SkippedCounts {
  sessionId: string;
  /** When the first skip for this session was counted (epoch ms). */
  firstAtMs: number;
  /** When the latest skip for this session was counted (epoch ms). */
  lastAtMs: number;
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

function whole(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export class SkippedTally {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /** `dbName` is only overridden by tests, to give each one an isolated database. */
  constructor(private readonly dbName: string = DB_NAME) {}

  private db(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
    if (!this.dbPromise) {
      this.dbPromise = openDb(this.dbName).catch((err: unknown) => {
        this.dbPromise = null;
        throw err;
      });
    }
    return this.dbPromise;
  }

  /** Adds skipped rows to the session's tally. Best-effort: a failure to count never fails delivery. */
  async add(sessionId: string, counts: SkippedCounts, atMs: number = Date.now()): Promise<void> {
    const frames = whole(counts.frames);
    const events = whole(counts.events);
    if (frames + events === 0) return;
    try {
      const db = await this.db();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const get = store.get(sessionId);
        get.onsuccess = () => {
          const previous = get.result as SkippedTallyEntry | undefined;
          const entry: SkippedTallyEntry = {
            sessionId,
            frames: (previous?.frames ?? 0) + frames,
            events: (previous?.events ?? 0) + events,
            firstAtMs: previous?.firstAtMs ?? atMs,
            lastAtMs: atMs,
          };
          store.put(entry);
          if (previous) return;
          // A new session: keep the tally small by dropping the least recently updated others.
          const all = store.getAll();
          all.onsuccess = () => {
            const others = (all.result as SkippedTallyEntry[]).filter((item) => item.sessionId !== sessionId);
            const excess = others.length + 1 - SKIPPED_TALLY_MAX_SESSIONS;
            if (excess <= 0) return;
            others.sort((a, b) => a.lastAtMs - b.lastAtMs);
            for (const old of others.slice(0, excess)) store.delete(old.sessionId);
          };
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error as unknown);
        tx.onabort = () => reject(tx.error as unknown);
      });
    } catch {
      /* best-effort */
    }
  }

  /** The session's tally, or null when nothing was skipped for it. Rejects when IndexedDB cannot be read. */
  async read(sessionId: string): Promise<SkippedTallyEntry | null> {
    const db = await this.db();
    const result = await new Promise<SkippedTallyEntry | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(sessionId);
      request.onsuccess = () => resolve(request.result as SkippedTallyEntry | undefined);
      request.onerror = () => reject(request.error as unknown);
    });
    return result ?? null;
  }

  /** Every session's tally, most recently updated first. Rejects when IndexedDB cannot be read. */
  async list(): Promise<SkippedTallyEntry[]> {
    const db = await this.db();
    const entries = await new Promise<SkippedTallyEntry[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as SkippedTallyEntry[]);
      request.onerror = () => reject(request.error as unknown);
    });
    return entries.sort((a, b) => b.lastAtMs - a.lastAtMs);
  }
}
