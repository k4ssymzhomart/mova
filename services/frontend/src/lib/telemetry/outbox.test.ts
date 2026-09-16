import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import { TelemetryBuffer, type FlushRpc, type FlushRpcArgs, type FogEventRow, type FrameRow } from "./buffer";
import { DurableQueue, claimRecord, settleRecord, type PendingBatch, type SaveMeta } from "./durableQueue";
import {
  OUTBOX_ATTEMPTS,
  OUTBOX_AUTH_RETRY_DELAYS_MS,
  createTelemetryOutbox,
  isAuthRefusal,
  isNonRetryable,
  shouldRetryRejected,
  signInIdOf,
  type OutboxStore,
  type OutboxTally,
  type TelemetryOutboxDeps,
} from "./outbox";
import { isSessionActive, notifyOutbox } from "./outboxRegistry";
import type { LockManagerLike } from "./recordOwnership";
import { SkippedTally, type SkippedCounts } from "./skippedTally";

function row(seq: number): FrameRow {
  return { recorded_at: new Date(Date.UTC(2026, 8, 15, 10, 0, 0, seq)).toISOString(), seq, imu: { role: "shank" } };
}

function rows(count: number, from = 0): FrameRow[] {
  return Array.from({ length: count }, (_, i) => row(from + i));
}

type MemoryStore = OutboxStore & {
  records: Map<string, PendingBatch>;
  save: (sessionId: string, frames: FrameRow[], events: FogEventRow[], meta?: SaveMeta) => Promise<void>;
};

/** An in-memory stand-in for DurableQueue that copies like IndexedDB's structured clone and settles like it. */
function memoryStore(initial: PendingBatch[] = []): MemoryStore {
  const records = new Map<string, PendingBatch>();
  for (const record of initial) records.set(record.sessionId, structuredClone(record));
  return {
    records,
    listSessionIds: async () => [...records.keys()],
    read: async (sessionId) => {
      const record = records.get(sessionId);
      return record ? structuredClone(record) : null;
    },
    save: async (sessionId, frames, events, meta = {}) => {
      records.set(sessionId, structuredClone({ sessionId, frames, events, savedAt: "", ...meta }));
    },
    settle: async (sessionId, request) => {
      const current = records.get(sessionId) ?? null;
      const { outcome, next } = settleRecord(current, request);
      if (outcome === "cleared") records.delete(sessionId);
      else if (outcome === "saved" && next && next !== current) records.set(sessionId, structuredClone(next));
      return outcome;
    },
    claim: async (sessionId, lease, nowMs = Date.now()) => {
      const { result, next } = claimRecord(records.get(sessionId) ?? null, lease, nowMs);
      if (next) records.set(sessionId, structuredClone(next));
      return structuredClone(result);
    },
  };
}

function memoryTally() {
  const added: { sessionId: string; counts: SkippedCounts }[] = [];
  const tally: OutboxTally & { added: typeof added } = {
    added,
    add: async (sessionId, counts) => {
      added.push({ sessionId, counts: { ...counts } });
    },
    read: async (sessionId) => {
      const mine = added.filter((entry) => entry.sessionId === sessionId);
      if (mine.length === 0) return null;
      return {
        sessionId,
        frames: mine.reduce((sum, entry) => sum + entry.counts.frames, 0),
        events: mine.reduce((sum, entry) => sum + entry.counts.events, 0),
        firstAtMs: 0,
        lastAtMs: 0,
      };
    },
  };
  return tally;
}

function record(sessionId: string, frames: FrameRow[], ownerId: string | null = "user-1"): PendingBatch {
  return { sessionId, frames, events: [], savedAt: "", ownerId };
}

function recordingRpc(answer: (args: FlushRpcArgs, call: number) => Awaited<ReturnType<FlushRpc>>) {
  const calls: FlushRpcArgs[] = [];
  const rpc: FlushRpc = async (args) => {
    calls.push(args);
    return answer(args, calls.length);
  };
  return { rpc, calls };
}

const ok = (args: FlushRpcArgs) => ({ data: { frames: args.p_frames.length, events: 0 }, error: null });
const offline = () => ({ data: null, error: { message: "Failed to fetch" } });
const noSleep = vi.fn(async (_ms: number) => undefined);
const nothingSkipped = { skipped: 0, skippedBySession: {} };

const modes: { mode: string; locks: LockManagerLike | null }[] = [
  { mode: "Web Locks", locks: navigator.locks as LockManagerLike },
  { mode: "lease fallback", locks: null },
];

describe.each(modes)("telemetry outbox ($mode)", ({ locks }) => {
  const outboxWith = (deps: TelemetryOutboxDeps) =>
    createTelemetryOutbox({
      getUserId: async () => "user-1",
      refreshAuth: async () => undefined,
      sleep: noSleep,
      tally: memoryTally(),
      locks,
      ...deps,
    });

  it("drains every stored session in bounded batches and clears the records", async () => {
    const store = memoryStore([record("a", rows(700)), record("b", rows(20)), record("c", rows(1))]);
    const { rpc, calls } = recordingRpc(ok);
    const outbox = outboxWith({ rpc, store });

    const result = await outbox.drain();

    expect(result).toEqual({ sessions: 3, sent: 721, ...nothingSkipped, remaining: 0, rejected: 0 });
    expect(calls.map((c) => [c.p_session, c.p_frames.length])).toEqual([
      ["a", 600],
      ["a", 100],
      ["b", 20],
      ["c", 1],
    ]);
    expect(store.records.size).toBe(0);
  });

  it("shares one run between concurrent drains", async () => {
    const store = memoryStore([record("a", rows(10)), record("b", rows(10))]);
    const pending: (() => void)[] = [];
    const calls: string[] = [];
    const rpc: FlushRpc = (args) =>
      new Promise((resolve) => {
        calls.push(args.p_session);
        pending.push(() => resolve(ok(args)));
      });
    const outbox = outboxWith({ rpc, store });

    const first = outbox.drain();
    const second = outbox.drain();
    expect(second).toBe(first);

    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0]();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]();

    expect(await first).toEqual({ sessions: 2, sent: 20, ...nothingSkipped, remaining: 0, rejected: 0 });
    expect(calls).toEqual(["a", "b"]);

    // A drain after the run finished starts a new one.
    const third = outbox.drain();
    expect(third).not.toBe(first);
    expect(await third).toEqual({ sessions: 0, sent: 0, ...nothingSkipped, remaining: 0, rejected: 0 });
  });

  it("retries a failed batch and delivers it once the network answers", async () => {
    const store = memoryStore([record("a", rows(30))]);
    const { rpc, calls } = recordingRpc((args, call) => (call === 1 ? offline() : ok(args)));
    const sleep = vi.fn(async (_ms: number) => undefined);
    const outbox = outboxWith({ rpc, store, sleep });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 30, ...nothingSkipped, remaining: 0, rejected: 0 });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(store.records.size).toBe(0);
  });

  it("stops after bounded attempts, keeps the rows and reports what remains", async () => {
    const store = memoryStore([record("a", rows(30)), record("b", rows(5))]);
    const { rpc, calls } = recordingRpc(offline);
    const outbox = outboxWith({ rpc, store });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 0, ...nothingSkipped, remaining: 35, rejected: 0 });
    expect(calls).toHaveLength(OUTBOX_ATTEMPTS);
    expect(store.records.get("a")?.frames).toHaveLength(30);
    expect(store.records.get("a")?.lease).toBeUndefined();
    expect(store.records.get("b")?.frames).toHaveLength(5);
  });

  it("writes partial progress back when a later batch fails", async () => {
    const store = memoryStore([record("a", rows(1300))]);
    const { rpc } = recordingRpc((args, call) => (call === 1 ? ok(args) : offline()));
    const outbox = outboxWith({ rpc, store });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 600, ...nothingSkipped, remaining: 700, rejected: 0 });
    const left = store.records.get("a");
    expect(left?.frames.map((f) => f.seq)).toEqual(Array.from({ length: 700 }, (_, i) => 600 + i));
    expect(left?.ownerId).toBe("user-1");
    expect(left?.lease).toBeUndefined();
  });

  it("removes only the rows it delivered, so rows written to the record during the run stay", async () => {
    const store = memoryStore([record("a", rows(1300))]);
    const { rpc } = recordingRpc((args, call) => {
      if (call === 1) {
        // While batch 1 is out, a recording rewrites the record wholesale: everything it holds, plus 200 new rows.
        void store.save("a", rows(1500), [], { ownerId: "user-1" });
        return ok(args);
      }
      return offline();
    });
    const outbox = outboxWith({ rpc, store });

    expect(await outbox.drain()).toMatchObject({ sent: 600 });
    expect(store.records.get("a")?.frames.map((f) => f.seq)).toEqual(Array.from({ length: 900 }, (_, i) => 600 + i));
  });

  it("removes rows the server skipped, reports them per session and counts them once the write-back has landed", async () => {
    const store = memoryStore([record("a", rows(700)), record("b", rows(10))]);
    const tally = memoryTally();
    const { rpc } = recordingRpc((args) =>
      args.p_session === "a"
        ? { data: { frames: args.p_frames.length - 20, events: 0, skipped: 20, skipped_events: 0 }, error: null }
        : ok(args),
    );
    const outbox = outboxWith({ rpc, store, tally });

    expect(await outbox.drain()).toEqual({
      sessions: 2,
      sent: 670,
      skipped: 40,
      skippedBySession: { a: { frames: 40, events: 0 } },
      remaining: 0,
      rejected: 0,
    });
    expect(store.records.size).toBe(0);
    expect(tally.added).toEqual([{ sessionId: "a", counts: { frames: 40, events: 0 } }]);
    expect(await outbox.skippedForSession("a")).toMatchObject({ frames: 40, events: 0 });
    expect(await outbox.skippedForSession("b")).toBeNull();
  });

  it("does not count skipped rows while the record still holds them", async () => {
    const store = memoryStore([record("a", rows(50))]);
    store.settle = async () => {
      throw new Error("QuotaExceededError");
    };
    const tally = memoryTally();
    const { rpc } = recordingRpc(() => ({ data: { frames: 30, events: 0, skipped: 20, skipped_events: 0 }, error: null }));
    const outbox = outboxWith({ rpc, store, tally });

    expect(await outbox.drain()).toMatchObject({ sent: 30, skipped: 20 });
    // The write-back failed, so the rows stay stored; they are counted when a later run removes them.
    expect(store.records.get("a")?.frames).toHaveLength(50);
    expect(tally.added).toEqual([]);
  });

  it("leaves a session a live buffer owns, and another account's rows, alone", async () => {
    const store = memoryStore([record("live", rows(10)), record("theirs", rows(10), "user-2"), record("mine", rows(3))]);
    const { rpc, calls } = recordingRpc(ok);
    const outbox = outboxWith({ rpc, store, isSessionActive: (id) => id === "live" });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 3, ...nothingSkipped, remaining: 0, rejected: 0 });
    expect(calls.map((c) => c.p_session)).toEqual(["mine"]);
    expect([...store.records.keys()].sort()).toEqual(["live", "theirs"]);
  });

  it("stops writing a record back once a buffer takes the session over mid-run", async () => {
    const store = memoryStore([record("a", rows(1300))]);
    let takenOver = false;
    const { rpc, calls } = recordingRpc((args) => {
      takenOver = true; // a recorder restarted for this session while the first batch was out
      return ok(args);
    });
    const outbox = outboxWith({ rpc, store, isSessionActive: () => takenOver });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 600, ...nothingSkipped, remaining: 0, rejected: 0 });
    expect(calls).toHaveLength(1);
    // The rows are untouched: the buffer recovered them on start and rewrites the record itself.
    expect(store.records.get("a")?.frames).toHaveLength(1300);
  });

  it("marks this account's record rejected on a non-retryable refusal, keeps it and does not retry it in the same page load", async () => {
    const store = memoryStore([record("gone", rows(40)), record("unknown-origin", rows(5), null)]);
    const { rpc, calls } = recordingRpc(() => ({
      data: null,
      error: { message: "invalid input syntax for type timestamp", code: "22007" },
    }));
    const outbox = outboxWith({ rpc, store, pageLoadId: "page-1", getSignInId: async () => "sign-in-1" });

    expect(await outbox.drain()).toEqual({ sessions: 2, sent: 0, ...nothingSkipped, remaining: 0, rejected: 45 });
    expect(calls).toHaveLength(2); // no retries for a refusal
    expect(store.records.get("gone")?.frames).toHaveLength(40);
    expect(store.records.get("gone")?.rejected).toMatchObject({
      code: "22007",
      pageLoadId: "page-1",
      signInId: "sign-in-1",
    });
    expect(store.records.get("unknown-origin")?.rejected).toBeUndefined();

    calls.length = 0;
    expect(await outbox.drain()).toMatchObject({ remaining: 0, rejected: 45 });
    expect(calls.map((c) => c.p_session)).toEqual(["unknown-origin"]);
  });

  it("refreshes the auth session and retries a 42501 before calling it final", async () => {
    const store = memoryStore([record("a", rows(40))]);
    const { rpc, calls } = recordingRpc((args, call) =>
      call <= 2
        ? { data: null, error: { code: "42501", message: "permission denied for function flush_session_telemetry_batch" } }
        : ok(args),
    );
    const refreshAuth = vi.fn(async () => undefined);
    const sleep = vi.fn(async (_ms: number) => undefined);
    const outbox = outboxWith({ rpc, store, refreshAuth, sleep });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 40, ...nothingSkipped, remaining: 0, rejected: 0 });
    expect(calls).toHaveLength(3);
    expect(refreshAuth).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual(OUTBOX_AUTH_RETRY_DELAYS_MS.slice(0, 2));
    expect(store.records.size).toBe(0);
  });

  it("marks a record whose 42501 outlasts the retries while the same account is still signed in", async () => {
    const store = memoryStore([record("a", rows(40))]);
    const { rpc, calls } = recordingRpc(() => ({ data: null, error: { code: "42501", message: "session not found for caller" } }));
    const refreshAuth = vi.fn(async () => undefined);
    const outbox = outboxWith({ rpc, store, refreshAuth });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 0, ...nothingSkipped, remaining: 0, rejected: 40 });
    expect(calls).toHaveLength(1 + OUTBOX_AUTH_RETRY_DELAYS_MS.length);
    expect(refreshAuth).toHaveBeenCalledTimes(OUTBOX_AUTH_RETRY_DELAYS_MS.length);
    expect(store.records.get("a")?.rejected).toMatchObject({ code: "42501" });
  });

  it("does not mark a record refused with 42501 after the account signed out; the rows wait and go after signing in", async () => {
    const store = memoryStore([record("a", rows(40)), record("b", rows(5))]);
    let signedIn = true;
    let refuse = true;
    const { rpc, calls } = recordingRpc((args) =>
      refuse ? { data: null, error: { code: "42501", message: "not authenticated" } } : ok(args),
    );
    const outbox = outboxWith({
      rpc,
      store,
      getUserId: async () => (signedIn ? "user-1" : null),
      refreshAuth: async () => {
        signedIn = false; // signed out in another tab while the run was going
      },
    });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 0, ...nothingSkipped, remaining: 45, rejected: 0 });
    expect(calls.map((c) => c.p_session)).toEqual(["a", "a", "a", "a"]);
    expect(store.records.get("a")?.rejected).toBeUndefined();
    expect(store.records.get("a")?.frames).toHaveLength(40);

    signedIn = true;
    refuse = false;
    expect(await outbox.drain()).toEqual({ sessions: 2, sent: 45, ...nothingSkipped, remaining: 0, rejected: 0 });
    expect(store.records.size).toBe(0);
  });

  it("tries a rejected record once more after the next app load and after the next sign-in", async () => {
    const refused = { data: null, error: { code: "23503", message: "violates foreign key constraint" } };
    const store = memoryStore([
      {
        ...record("a", rows(8)),
        rejected: { code: "23503", message: "earlier refusal", atMs: 1, pageLoadId: "page-1", signInId: "sign-in-1" },
      },
    ]);
    let answer: (args: FlushRpcArgs) => Awaited<ReturnType<FlushRpc>> = () => refused;
    const { rpc, calls } = recordingRpc((args) => answer(args));
    let signInId = "sign-in-1";
    const openApp = (pageLoadId: string) => outboxWith({ rpc, store, pageLoadId, getSignInId: async () => signInId });

    // The same page load and sign-in that saw the refusal: not tried.
    expect(await openApp("page-1").drain()).toMatchObject({ rejected: 8 });
    expect(calls).toHaveLength(0);

    // The app loads again: one more try. Refused again, it is marked for this page load.
    const reloaded = openApp("page-2");
    expect(await reloaded.drain()).toMatchObject({ sessions: 1, sent: 0, rejected: 8 });
    expect(calls).toHaveLength(1);
    expect(store.records.get("a")?.rejected).toMatchObject({ pageLoadId: "page-2", signInId: "sign-in-1" });
    expect(await reloaded.drain()).toMatchObject({ rejected: 8 });
    expect(calls).toHaveLength(1);

    // A new sign-in: one more try, which now goes through.
    signInId = "sign-in-2";
    answer = ok;
    expect(await reloaded.drain()).toMatchObject({ sent: 8, remaining: 0, rejected: 0 });
    expect(calls).toHaveLength(2);
    expect(store.records.size).toBe(0);
  });

  it("sends nothing without a signed-in account but still reports what waits", async () => {
    const store = memoryStore([record("a", rows(12))]);
    const { rpc, calls } = recordingRpc(ok);
    const outbox = outboxWith({ rpc, store, getUserId: async () => null });

    expect(await outbox.drain()).toEqual({ sessions: 0, sent: 0, ...nothingSkipped, remaining: 12, rejected: 0 });
    expect(calls).toHaveLength(0);
  });

  it("takes another pass when a recording stops with rows left during a run", async () => {
    const store = memoryStore([record("a", rows(10))]);
    const { rpc, calls } = recordingRpc((args, call) => {
      if (call === 1) {
        void store.save("b", rows(7), [], { ownerId: "user-1" });
        notifyOutbox();
      }
      return ok(args);
    });
    const outbox = outboxWith({ rpc, store });

    // "b" sorts after "a" but was written after the listing was taken; the second pass finds it.
    expect(await outbox.drain()).toEqual({ sessions: 2, sent: 17, ...nothingSkipped, remaining: 0, rejected: 0 });
    expect(calls.map((c) => c.p_session)).toEqual(["a", "b"]);
  });
});

describe("outbox rules", () => {
  it("classifies ownership, data and integrity errors as non-retryable, and network errors as retryable", () => {
    expect(isNonRetryable({ code: "42501" })).toBe(true);
    expect(isNonRetryable({ code: "22P02" })).toBe(true);
    expect(isNonRetryable({ code: "23503" })).toBe(true);
    expect(isNonRetryable({ message: "Failed to fetch" })).toBe(false);
    expect(isNonRetryable({ code: "57014" })).toBe(false);
    expect(isNonRetryable({ code: "PGRST301" })).toBe(false);
    expect(isAuthRefusal({ code: "42501" })).toBe(true);
    expect(isAuthRefusal({ code: "22023" })).toBe(false);
  });

  it("retries a rejected record in a page load or sign-in other than the refusal's own", () => {
    const mark = { code: "22023", message: "x", atMs: 1, pageLoadId: "page-1", signInId: "sign-in-1" };
    expect(shouldRetryRejected(mark, "page-1", "sign-in-1")).toBe(false);
    expect(shouldRetryRejected(mark, "page-1", null)).toBe(false);
    expect(shouldRetryRejected(mark, "page-2", "sign-in-1")).toBe(true);
    expect(shouldRetryRejected(mark, "page-1", "sign-in-2")).toBe(true);
    // A mark stored before page loads were recorded is tried again.
    expect(shouldRetryRejected({ code: "42501", message: "x", atMs: 1 }, "page-1", "sign-in-1")).toBe(true);
  });

  it("reads the sign-in id from an access token's session_id claim", () => {
    const encode = (claims: object) =>
      btoa(JSON.stringify(claims)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(signInIdOf(`e30.${encode({ sub: "user-1", session_id: "6f1c-ab" })}.sig`)).toBe("6f1c-ab");
    expect(signInIdOf(`e30.${encode({ sub: "user-1" })}.sig`)).toBeNull();
    expect(signInIdOf("not-a-token")).toBeNull();
    expect(signInIdOf("e30.%%%.sig")).toBeNull();
    expect(signInIdOf(undefined)).toBeNull();
  });
});

describe("rows left by a stopped recording", () => {
  let dbCounter = 0;
  const dbName = () => `test-outbox-${Date.now()}-${(dbCounter += 1)}`;

  it("stay in IndexedDB after stop gives up, are counted after a reload, and are delivered by the outbox", async () => {
    const name = dbName();
    const sessionId = `session-reload-${name}`;
    const failing: FlushRpc = async () => offline();
    const buffer = new TelemetryBuffer(sessionId, undefined, {
      rpc: failing,
      durable: new DurableQueue(name),
      getAuth: async () => ({ url: "https://example.test", key: "anon", token: "t", userId: "user-1" }),
      tally: null,
    });
    await buffer.start();
    expect(isSessionActive(sessionId)).toBe(true);
    for (const frame of rows(25)) buffer.pushFrame(frame);

    await buffer.stop({ budgetMs: 50 });
    expect(buffer.counters.pending).toBe(25);
    expect(buffer.counters.framesConfirmed).toBe(0);
    expect(isSessionActive(sessionId)).toBe(false);

    // A reload: a new page opens the database afresh and knows nothing about the old buffer.
    const reopened = new DurableQueue(name);
    const { rpc, calls } = recordingRpc(ok);
    const outbox = createTelemetryOutbox({
      rpc,
      store: reopened,
      getUserId: async () => "user-1",
      tally: memoryTally(),
      sleep: noSleep,
    });

    expect(await outbox.pendingForSession(sessionId)).toBe(25);
    expect(await outbox.pendingForSession("never-recorded")).toBe(0);

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 25, ...nothingSkipped, remaining: 0, rejected: 0 });
    expect(calls[0].p_frames.map((f) => f.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(await outbox.pendingForSession(sessionId)).toBe(0);
  });

  it("pendingForSession and skippedForSession reject instead of answering 0 when IndexedDB cannot be read", async () => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      const outbox = createTelemetryOutbox({
        rpc: async () => offline(),
        store: new DurableQueue(dbName()),
        tally: new SkippedTally(dbName()),
        getUserId: async () => "user-1",
      });
      await expect(outbox.pendingForSession("a")).rejects.toThrow();
      await expect(outbox.skippedForSession("a")).rejects.toThrow();
      await expect(outbox.drain()).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
