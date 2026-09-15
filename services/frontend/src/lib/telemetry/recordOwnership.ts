// Which tab may write a session's `mova-telemetry` record.
//
// A live TelemetryBuffer rewrites its session's record about once a second, and the outbox delivers the records
// stopped buffers left behind. Inside one tab outboxRegistry.ts keeps the two apart. Across tabs this file does:
//
//  - Where the browser has Web Locks, a recording requests the exclusive lock `mova-telemetry:<session>` when it starts
//    and releases it after its last write. It never waits for the lock to record: while another tab's outbox holds it,
//    the recording writes as usual, and that outbox gives the record back before its next batch because it sees the
//    request waiting. An outbox takes the lock only when it is free (ifAvailable) and otherwise skips the record.
//  - Without Web Locks, a lease stored on the record names the holder. A recording stamps a 15 s lease on every write,
//    renews it every 5 s, and its last write carries none. An outbox claims a record with a 2 min delivery lease in one
//    transaction, only when nobody else's lease is current, renews it at each write-back and drops it at the end. A
//    write-back that finds somebody else's current lease leaves the record alone. A tab that closes without releasing
//    its lease only delays others until the lease expires.
//
// In both cases the outbox's write-back removes only the rows it delivered, re-reading the record in the same
// transaction (DurableQueue.settle). A race between a check and a write can therefore cost a resend, never a row.

import type { DurableQueue, PendingBatch, RecordLease } from "./durableQueue";

export const RECORDING_LEASE_MS = 15_000;
export const RECORDING_LEASE_RENEW_MS = 5_000;
export const DELIVERY_LEASE_MS = 120_000;

export type LockManagerLike = Pick<LockManager, "request" | "query">;

export function recordLockName(sessionId: string): string {
  return `mova-telemetry:${sessionId}`;
}

/** The browser's Web Locks, or null where there are none (older browsers, pages not served over HTTPS). */
export function browserLocks(): LockManagerLike | null {
  if (typeof navigator === "undefined") return null;
  const locks = (navigator as { locks?: Partial<LockManagerLike> }).locks;
  return locks && typeof locks.request === "function" && typeof locks.query === "function"
    ? (locks as LockManagerLike)
    : null;
}

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* not a secure context */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const PAGE_LOAD_ID = randomId();
let recordingHolds = 0;

/** Identifies this page load: two tabs differ, and so does one tab before and after a reload. */
export function pageLoadId(): string {
  return PAGE_LOAD_ID;
}

export interface OwnershipOptions {
  /** Web Locks to use, or null for the lease fallback. */
  locks: LockManagerLike | null;
  now?: () => number;
}

export interface RecordingHold {
  /** Resolves once ownership is announced: at once under Web Locks, after the first lease stamp otherwise. */
  readonly ready: Promise<void>;
  /** The lease to store with each write of the record: null under Web Locks and once release() has begun. */
  lease(): RecordLease | null;
  /** Runs `finalWrite` while still holding the record, then gives the record up. A second call does nothing. */
  release(finalWrite?: () => Promise<void>): Promise<void>;
}

/**
 * Announces that a live recording owns `sessionId`'s record, in every tab. `leases` renews the lease on the stored
 * record between writes (lease fallback only); without it the lease is only refreshed by the recording's own writes.
 */
export function holdRecording(
  sessionId: string,
  { locks, now = () => Date.now(), leases = null }: OwnershipOptions & { leases?: Pick<DurableQueue, "stampLease"> | null },
): RecordingHold {
  let released = false;

  if (locks) {
    let releaseLock: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const options: LockOptions = controller ? { mode: "exclusive", signal: controller.signal } : { mode: "exclusive" };
    // Not awaited: recording starts at once. An abort after the grant has no effect; before it, it withdraws the request.
    void locks.request(recordLockName(sessionId), options, () => held).catch(() => undefined);
    return {
      ready: Promise.resolve(),
      lease: () => null,
      async release(finalWrite) {
        if (released) return;
        released = true;
        try {
          await finalWrite?.();
        } finally {
          controller?.abort();
          releaseLock();
        }
      },
    };
  }

  recordingHolds += 1;
  const owner = `recording:${PAGE_LOAD_ID}:${recordingHolds}`;
  const make = (): RecordLease => ({ owner, kind: "recording", expiresAtMs: now() + RECORDING_LEASE_MS });
  let lastStampAt = Number.NEGATIVE_INFINITY;
  let stamps: Promise<void> = Promise.resolve();
  const stamp = () => {
    if (!leases) return;
    lastStampAt = now();
    const lease = make();
    stamps = stamps.then(() => leases.stampLease(sessionId, lease)).catch(() => undefined);
  };
  stamp();
  const ready = stamps;
  const timer = leases
    ? setInterval(() => {
        if (!released && now() - lastStampAt >= RECORDING_LEASE_RENEW_MS) stamp();
      }, RECORDING_LEASE_RENEW_MS)
    : null;

  return {
    ready,
    lease() {
      if (released) return null;
      lastStampAt = now();
      return make();
    },
    async release(finalWrite) {
      if (released) return;
      released = true;
      if (timer) clearInterval(timer);
      await stamps; // a renewal already under way lands before the final write, not after it
      await finalWrite?.();
    },
  };
}

export interface DeliveryClaim {
  /** The lease owner a write-back checks stored leases against: null under Web Locks. */
  readonly owner: string | null;
  /** A renewed delivery lease for a write-back: undefined under Web Locks. */
  lease(): RecordLease | undefined;
  /** False once a recording, in this tab or another, has asked for the record. Always true under the lease fallback,
   * where the write-back itself finds the recording's lease. */
  stillOwned(): Promise<boolean>;
}

export type DeliveryResult<T> = { status: "delivered"; value: T } | { status: "held" } | { status: "missing" };

/**
 * Runs `task` on the stored record while this outbox holds it, or returns "held" without waiting when a recording or
 * another delivery holds it. The task must end with a write-back that drops the lease (lease fallback); `release`
 * is called when it throws instead. Rejects when IndexedDB cannot be read.
 */
export async function deliverUnderOwnership<T>(
  sessionId: string,
  {
    locks,
    now = () => Date.now(),
    store,
    release,
    pageLoadId: page = PAGE_LOAD_ID,
  }: OwnershipOptions & {
    store: Pick<DurableQueue, "read" | "claim">;
    release: (claim: DeliveryClaim) => Promise<void>;
    /** Names this page's deliveries in their leases. Only tests, which run several "tabs" in one page, override it. */
    pageLoadId?: string;
  },
  task: (record: PendingBatch, claim: DeliveryClaim) => Promise<T>,
): Promise<DeliveryResult<T>> {
  if (locks) {
    const name = recordLockName(sessionId);
    const claim: DeliveryClaim = {
      owner: null,
      lease: () => undefined,
      async stillOwned() {
        try {
          const snapshot = await locks.query();
          return !(snapshot.pending ?? []).some((request) => request.name === name);
        } catch {
          return true; // the write-back still removes only delivered rows
        }
      },
    };
    const result: DeliveryResult<T> = await locks.request(
      name,
      { mode: "exclusive", ifAvailable: true },
      async (lock): Promise<DeliveryResult<T>> => {
        if (!lock) return { status: "held" };
        const record = await store.read(sessionId);
        if (!record) return { status: "missing" };
        return { status: "delivered", value: await task(record, claim) };
      },
    );
    return result;
  }

  const owner = `delivery:${page}`;
  const claim: DeliveryClaim = {
    owner,
    lease: () => ({ owner, kind: "delivery", expiresAtMs: now() + DELIVERY_LEASE_MS }),
    stillOwned: async () => true,
  };
  const claimed = await store.claim(sessionId, claim.lease() as RecordLease, now());
  if (claimed.status !== "claimed") return claimed;
  try {
    return { status: "delivered", value: await task(claimed.record, claim) };
  } catch (err) {
    await release(claim).catch(() => undefined);
    throw err;
  }
}
