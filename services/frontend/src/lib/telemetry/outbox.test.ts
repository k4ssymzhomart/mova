import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import { TelemetryBuffer, type FlushRpc, type FlushRpcArgs, type FrameRow } from "./buffer";
import { DurableQueue, type PendingBatch, type SaveMeta } from "./durableQueue";
import { OUTBOX_ATTEMPTS, createTelemetryOutbox, isNonRetryable, type OutboxStore } from "./outbox";
import { isSessionActive, notifyOutbox } from "./outboxRegistry";

function row(seq: number): FrameRow {
  return { recorded_at: new Date(Date.UTC(2026, 8, 15, 10, 0, 0, seq)).toISOString(), seq, imu: { role: "shank" } };
}

function rows(count: number, from = 0): FrameRow[] {
  return Array.from({ length: count }, (_, i) => row(from + i));
}

/** An in-memory stand-in for DurableQueue that copies like IndexedDB's structured clone. */
function memoryStore(initial: PendingBatch[] = []) {
  const records = new Map<string, PendingBatch>();
  for (const record of initial) records.set(record.sessionId, structuredClone(record));
  const store: OutboxStore & { records: Map<string, PendingBatch> } = {
    records,
    listSessionIds: async () => [...records.keys()],
    read: async (sessionId) => {
      const record = records.get(sessionId);
      return record ? structuredClone(record) : null;
    },
    save: async (sessionId, frames, events, meta: SaveMeta = {}) => {
      records.set(sessionId, structuredClone({ sessionId, frames, events, savedAt: "", ...meta }));
    },
    clear: async (sessionId) => {
      records.delete(sessionId);
    },
  };
  return store;
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

describe("telemetry outbox", () => {
  it("drains every stored session in bounded batches and clears the records", async () => {
    const store = memoryStore([record("a", rows(700)), record("b", rows(20)), record("c", rows(1))]);
    const { rpc, calls } = recordingRpc(ok);
    const outbox = createTelemetryOutbox({ rpc, store, getUserId: async () => "user-1", sleep: noSleep });

    const result = await outbox.drain();

    expect(result).toEqual({ sessions: 3, sent: 721, remaining: 0, rejected: 0 });
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
    const outbox = createTelemetryOutbox({ rpc, store, getUserId: async () => "user-1", sleep: noSleep });

    const first = outbox.drain();
    const second = outbox.drain();
    expect(second).toBe(first);

    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0]();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]();

    expect(await first).toEqual({ sessions: 2, sent: 20, remaining: 0, rejected: 0 });
    expect(calls).toEqual(["a", "b"]);

    // A drain after the run finished starts a new one.
    const third = outbox.drain();
    expect(third).not.toBe(first);
    expect(await third).toEqual({ sessions: 0, sent: 0, remaining: 0, rejected: 0 });
  });

  it("retries a failed batch and delivers it once the network answers", async () => {
    const store = memoryStore([record("a", rows(30))]);
    const { rpc, calls } = recordingRpc((args, call) => (call === 1 ? offline() : ok(args)));
    const sleep = vi.fn(async (_ms: number) => undefined);
    const outbox = createTelemetryOutbox({ rpc, store, getUserId: async () => "user-1", sleep });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 30, remaining: 0, rejected: 0 });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(1000);
    expect(store.records.size).toBe(0);
  });

  it("stops after bounded attempts, keeps the rows and reports what remains", async () => {
    const store = memoryStore([record("a", rows(30)), record("b", rows(5))]);
    const { rpc, calls } = recordingRpc(offline);
    const outbox = createTelemetryOutbox({ rpc, store, getUserId: async () => "user-1", sleep: noSleep });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 0, remaining: 35, rejected: 0 });
    expect(calls).toHaveLength(OUTBOX_ATTEMPTS);
    expect(store.records.get("a")?.frames).toHaveLength(30);
    expect(store.records.get("b")?.frames).toHaveLength(5);
  });

  it("writes partial progress back when a later batch fails", async () => {
    const store = memoryStore([record("a", rows(1300))]);
    const { rpc } = recordingRpc((args, call) => (call === 1 ? ok(args) : offline()));
    const outbox = createTelemetryOutbox({ rpc, store, getUserId: async () => "user-1", sleep: noSleep });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 600, remaining: 700, rejected: 0 });
    const left = store.records.get("a");
    expect(left?.frames.map((f) => f.seq)).toEqual(Array.from({ length: 700 }, (_, i) => 600 + i));
    expect(left?.ownerId).toBe("user-1");
  });

  it("treats an answer that reports skipped rows as delivered", async () => {
    const store = memoryStore([record("a", rows(50))]);
    const { rpc } = recordingRpc(() => ({ data: { frames: 30, events: 0, skipped: 20 }, error: null }));
    const outbox = createTelemetryOutbox({ rpc, store, getUserId: async () => "user-1", sleep: noSleep });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 50, remaining: 0, rejected: 0 });
    expect(store.records.size).toBe(0);
  });

  it("leaves a session a live buffer owns, and another account's rows, alone", async () => {
    const store = memoryStore([record("live", rows(10)), record("theirs", rows(10), "user-2"), record("mine", rows(3))]);
    const { rpc, calls } = recordingRpc(ok);
    const outbox = createTelemetryOutbox({
      rpc,
      store,
      getUserId: async () => "user-1",
      isSessionActive: (id) => id === "live",
      sleep: noSleep,
    });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 3, remaining: 0, rejected: 0 });
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
    const outbox = createTelemetryOutbox({
      rpc,
      store,
      getUserId: async () => "user-1",
      isSessionActive: () => takenOver,
      sleep: noSleep,
    });

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 600, remaining: 0, rejected: 0 });
    expect(calls).toHaveLength(1);
    // The record is untouched: the buffer recovered it on start and rewrites it itself.
    expect(store.records.get("a")?.frames).toHaveLength(1300);
  });

  it("marks this account's record rejected on a non-retryable refusal, keeps it and does not retry it", async () => {
    const store = memoryStore([record("gone", rows(40)), record("unknown-origin", rows(5), null)]);
    const { rpc, calls } = recordingRpc(() => ({
      data: null,
      error: { message: "session not found for caller", code: "42501" },
    }));
    const outbox = createTelemetryOutbox({ rpc, store, getUserId: async () => "user-1", sleep: noSleep });

    expect(await outbox.drain()).toEqual({ sessions: 2, sent: 0, remaining: 0, rejected: 45 });
    expect(calls).toHaveLength(2); // no retries for a refusal
    expect(store.records.get("gone")?.frames).toHaveLength(40);
    expect(store.records.get("gone")?.rejected).toMatchObject({ code: "42501" });
    expect(store.records.get("unknown-origin")?.rejected).toBeUndefined();

    calls.length = 0;
    expect(await outbox.drain()).toMatchObject({ remaining: 0, rejected: 45 });
    expect(calls.map((c) => c.p_session)).toEqual(["unknown-origin"]);
  });

  it("sends nothing without a signed-in account but still reports what waits", async () => {
    const store = memoryStore([record("a", rows(12))]);
    const { rpc, calls } = recordingRpc(ok);
    const outbox = createTelemetryOutbox({ rpc, store, getUserId: async () => null, sleep: noSleep });

    expect(await outbox.drain()).toEqual({ sessions: 0, sent: 0, remaining: 12, rejected: 0 });
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
    const outbox = createTelemetryOutbox({ rpc, store, getUserId: async () => "user-1", sleep: noSleep });

    // "b" sorts after "a" but was written after the listing was taken; the second pass finds it.
    expect(await outbox.drain()).toEqual({ sessions: 2, sent: 17, remaining: 0, rejected: 0 });
    expect(calls.map((c) => c.p_session)).toEqual(["a", "b"]);
  });

  it("classifies ownership, data and integrity errors as non-retryable, and network errors as retryable", () => {
    expect(isNonRetryable({ code: "42501" })).toBe(true);
    expect(isNonRetryable({ code: "22P02" })).toBe(true);
    expect(isNonRetryable({ code: "23503" })).toBe(true);
    expect(isNonRetryable({ message: "Failed to fetch" })).toBe(false);
    expect(isNonRetryable({ code: "57014" })).toBe(false);
    expect(isNonRetryable({ code: "PGRST301" })).toBe(false);
  });
});

describe("rows left by a stopped recording", () => {
  let dbCounter = 0;
  const dbName = () => `test-outbox-${Date.now()}-${(dbCounter += 1)}`;

  it("stay in IndexedDB after stop gives up, are counted after a reload, and are delivered by the outbox", async () => {
    const name = dbName();
    const sessionId = "session-reload";
    const failing: FlushRpc = async () => offline();
    const buffer = new TelemetryBuffer(sessionId, undefined, {
      rpc: failing,
      durable: new DurableQueue(name),
      getAuth: async () => ({ url: "https://example.test", key: "anon", token: "t", userId: "user-1" }),
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
    const outbox = createTelemetryOutbox({ rpc, store: reopened, getUserId: async () => "user-1", sleep: noSleep });

    expect(await outbox.pendingForSession(sessionId)).toBe(25);
    expect(await outbox.pendingForSession("never-recorded")).toBe(0);

    expect(await outbox.drain()).toEqual({ sessions: 1, sent: 25, remaining: 0, rejected: 0 });
    expect(calls[0].p_frames.map((f) => f.seq)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(await outbox.pendingForSession(sessionId)).toBe(0);
  });

  it("pendingForSession rejects instead of answering 0 when IndexedDB cannot be read", async () => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      const outbox = createTelemetryOutbox({
        rpc: async () => offline(),
        store: new DurableQueue(dbName()),
        getUserId: async () => "user-1",
      });
      await expect(outbox.pendingForSession("a")).rejects.toThrow();
      await expect(outbox.drain()).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
