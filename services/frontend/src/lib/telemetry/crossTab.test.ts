import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import { TelemetryBuffer, type FlushRpc, type FlushRpcArgs, type FrameRow } from "./buffer";
import { DurableQueue, type RecordLease, type SaveMeta } from "./durableQueue";
import { createTelemetryOutbox, type OutboxTally } from "./outbox";
import { RECORDING_LEASE_MS, RECORDING_LEASE_RENEW_MS, recordLockName, type LockManagerLike } from "./recordOwnership";

// Two tabs of the same browser share IndexedDB and Web Locks but not memory. Each "tab" here gets its own DurableQueue
// connection and its own outbox, whose in-tab registry knows nothing about the other tab's buffer.

const USER = "user-1";

function row(seq: number): FrameRow {
  return { recorded_at: new Date(Date.UTC(2026, 8, 15, 10, 0, 0, seq)).toISOString(), seq, imu: { role: "shank" } };
}

function rows(count: number, from = 0): FrameRow[] {
  return Array.from({ length: count }, (_, i) => row(from + i));
}

const seqRange = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

const ok = (args: FlushRpcArgs) => ({
  data: { frames: args.p_frames.length, events: 0, skipped: 0, skipped_events: 0 },
  error: null,
});
const offline = () => ({ data: null, error: { message: "Failed to fetch" } });
const offlineRpc: FlushRpc = async () => offline();
const auth = async () => ({ url: "https://db.test", key: "anon", token: "t", userId: USER });
const noTally: OutboxTally = { add: async () => undefined, read: async () => null };

let counter = 0;
const unique = (label: string) => `${label}-${Date.now()}-${(counter += 1)}`;

/** Forces the buffer's durable write now instead of after its one-second throttle. */
function persist(buffer: TelemetryBuffer): Promise<void> {
  return (buffer as unknown as { persistNow: () => Promise<void> }).persistNow();
}

function recording(sessionId: string, dbName: string, locks: LockManagerLike | null, rpc: FlushRpc = offlineRpc) {
  return new TelemetryBuffer(sessionId, undefined, {
    rpc,
    durable: new DurableQueue(dbName),
    getAuth: auth,
    locks,
    tally: null,
  });
}

function outboxInAnotherTab(dbName: string, locks: LockManagerLike | null, rpc: FlushRpc) {
  return createTelemetryOutbox({
    rpc,
    store: new DurableQueue(dbName),
    getUserId: async () => USER,
    refreshAuth: async () => undefined,
    isSessionActive: () => false,
    locks,
    tally: noTally,
    pageLoadId: unique("page"),
    sleep: async () => undefined,
  });
}

async function storedSeqs(dbName: string, sessionId: string): Promise<number[]> {
  const stored = await new DurableQueue(dbName).read(sessionId);
  return (stored?.frames ?? []).map((frame) => frame.seq).sort((a, b) => a - b);
}

const modes: { mode: string; locks: LockManagerLike | null }[] = [
  { mode: "Web Locks", locks: navigator.locks as LockManagerLike },
  { mode: "the lease fallback (no Web Locks)", locks: null },
];

describe.each(modes)("two tabs, with $mode", ({ locks }) => {
  it("an outbox in another tab leaves a live recording's record alone, then delivers every row once it stops", async () => {
    const dbName = unique("db");
    const sessionId = unique("session");
    const buffer = recording(sessionId, dbName, locks);
    await buffer.start();
    for (const frame of rows(1000)) buffer.pushFrame(frame);
    await persist(buffer);

    const calls: FlushRpcArgs[] = [];
    const otherTab = outboxInAnotherTab(dbName, locks, async (args) => {
      calls.push(args);
      return ok(args);
    });
    expect(await otherTab.drain()).toMatchObject({ sessions: 0, sent: 0, remaining: 1000 });
    expect(calls).toHaveLength(0);
    expect(await storedSeqs(dbName, sessionId)).toEqual(seqRange(0, 1000));

    for (const frame of rows(500, 1000)) buffer.pushFrame(frame);
    await buffer.stop({ budgetMs: 30 });
    expect(buffer.counters.pending).toBe(1500);

    expect(await otherTab.drain()).toMatchObject({ sessions: 1, sent: 1500, remaining: 0, rejected: 0 });
    expect(calls.flatMap((c) => c.p_frames.map((f) => f.seq)).sort((a, b) => a - b)).toEqual(seqRange(0, 1500));
    expect(await new DurableQueue(dbName).read(sessionId)).toBeNull();
  });

  it("a delivery that began before the recording removes only the rows it sent, so the recording's newest rows stay", async () => {
    const dbName = unique("db");
    const sessionId = unique("session");
    // An earlier page recorded 1000 rows and was reloaded before it could send them.
    await new DurableQueue(dbName).save(sessionId, rows(1000), [], { ownerId: USER });

    // Another tab drains: batch 1 lands, batch 2 hangs until released, then fails.
    let call = 0;
    const gate: { open?: () => void } = {};
    const otherTab = outboxInAnotherTab(dbName, locks, async (args) => {
      call += 1;
      if (call === 1) return ok(args);
      if (call === 2) {
        await new Promise<void>((resolve) => {
          gate.open = resolve;
        });
      }
      return offline();
    });
    const draining = otherTab.drain();
    await vi.waitFor(() => expect(gate.open).toBeDefined());

    // This tab starts recording into the same session, records 500 more rows and finishes while offline.
    const buffer = recording(sessionId, dbName, locks);
    await buffer.start();
    for (const frame of rows(500, 1000)) buffer.pushFrame(frame);
    await buffer.stop({ budgetMs: 30 });
    expect(buffer.counters.pending).toBe(1500);
    expect(await storedSeqs(dbName, sessionId)).toEqual(seqRange(0, 1500));

    gate.open?.();
    expect(await draining).toMatchObject({ sent: 600, rejected: 0 });

    // Rows 0..599 reached the server. Every other row, the recording's newest 500 included, is still on the device.
    expect(await storedSeqs(dbName, sessionId)).toEqual(seqRange(600, 1500));
  });

  it("a delivery that fails while the recording is still live takes none of the recording's rows off the device", async () => {
    const dbName = unique("db");
    const sessionId = unique("session");
    await new DurableQueue(dbName).save(sessionId, rows(1000), [], { ownerId: USER });

    let call = 0;
    const gate: { open?: () => void } = {};
    const otherTab = outboxInAnotherTab(dbName, locks, async (args) => {
      call += 1;
      if (call === 1) return ok(args);
      if (call === 2) {
        await new Promise<void>((resolve) => {
          gate.open = resolve;
        });
      }
      return offline();
    });
    const draining = otherTab.drain();
    await vi.waitFor(() => expect(gate.open).toBeDefined());

    const buffer = recording(sessionId, dbName, locks);
    await buffer.start();
    for (const frame of rows(500, 1000)) buffer.pushFrame(frame);
    await persist(buffer);

    gate.open?.();
    await draining;
    const duringRecording = new Set(await storedSeqs(dbName, sessionId));
    expect(seqRange(600, 1500).filter((seq) => !duringRecording.has(seq))).toEqual([]);

    await buffer.stop({ budgetMs: 30 });
    expect(await storedSeqs(dbName, sessionId)).toEqual(seqRange(0, 1500));
  });

  it("a delivery hands the record over when a recording starts in another tab, and no row is lost", async () => {
    const dbName = unique("db");
    const sessionId = unique("session");
    await new DurableQueue(dbName).save(sessionId, rows(1300), [], { ownerId: USER });

    const onServer = new Set<number>();
    const toServer: FlushRpc = async (args) => {
      for (const frame of args.p_frames) onServer.add(frame.seq);
      return ok(args);
    };
    const tab: { buffer?: TelemetryBuffer } = {};
    const outboxCalls: number[] = [];
    const otherTab = outboxInAnotherTab(dbName, locks, async (args) => {
      outboxCalls.push(args.p_frames.length);
      if (!tab.buffer) {
        // The exercise opens in this tab while the other tab's first batch is out.
        tab.buffer = recording(sessionId, dbName, locks, toServer);
        await tab.buffer.start();
      }
      return toServer(args);
    });

    expect(await otherTab.drain()).toMatchObject({ rejected: 0 });
    // Under Web Locks the outbox sees the recording's request before its next batch and stops there.
    if (locks) expect(outboxCalls).toEqual([600]);

    await tab.buffer?.stop();
    expect(seqRange(0, 1300).filter((seq) => !onServer.has(seq))).toEqual([]);
    expect(await new DurableQueue(dbName).read(sessionId)).toBeNull();
  });

  it("two outboxes in different tabs do not deliver the same record at the same time", async () => {
    const dbName = unique("db");
    const sessionId = unique("session");
    await new DurableQueue(dbName).save(sessionId, rows(50), [], { ownerId: USER });

    const gate: { open?: () => void } = {};
    const first = outboxInAnotherTab(dbName, locks, async (args) => {
      await new Promise<void>((resolve) => {
        gate.open = resolve;
      });
      return ok(args);
    });
    const secondCalls: FlushRpcArgs[] = [];
    const second = outboxInAnotherTab(dbName, locks, async (args) => {
      secondCalls.push(args);
      return ok(args);
    });

    const firstRun = first.drain();
    await vi.waitFor(() => expect(gate.open).toBeDefined());
    expect(await second.drain()).toMatchObject({ sent: 0, remaining: 50 });
    expect(secondCalls).toHaveLength(0);

    gate.open?.();
    expect(await firstRun).toMatchObject({ sent: 50, remaining: 0 });
    expect(await new DurableQueue(dbName).read(sessionId)).toBeNull();
  });
});

describe("record ownership, per mechanism", () => {
  it("a recording holds its session's Web Lock from start until after its last write", async () => {
    const sessionId = unique("session");
    const name = recordLockName(sessionId);
    const held = async () => ((await navigator.locks.query()).held ?? []).some((lock) => lock.name === name);
    const heldAtWrite: boolean[] = [];
    const durable = {
      save: async () => {
        heldAtWrite.push(await held());
      },
      load: async () => null,
      clear: async () => {
        heldAtWrite.push(await held());
      },
    };
    const buffer = new TelemetryBuffer(sessionId, undefined, {
      rpc: offlineRpc,
      durable,
      getAuth: auth,
      locks: navigator.locks as LockManagerLike,
      tally: null,
    });

    await buffer.start();
    await vi.waitFor(async () => expect(await held()).toBe(true));
    buffer.pushFrame(row(0));
    await buffer.stop({ budgetMs: 0 });

    expect(heldAtWrite.at(-1)).toBe(true);
    await vi.waitFor(async () => expect(await held()).toBe(false));
  });

  it("without Web Locks a recording stamps its lease at start and on every write, renews it, and its last write carries none", async () => {
    vi.useFakeTimers();
    try {
      const metas: (SaveMeta | undefined)[] = [];
      const stamps: (RecordLease | null)[] = [];
      const durable = {
        save: async (_sessionId: string, _frames: FrameRow[], _events: unknown[], meta?: SaveMeta) => {
          metas.push(meta);
        },
        load: async () => null,
        clear: async () => undefined,
        stampLease: async (_sessionId: string, lease: RecordLease | null) => {
          stamps.push(lease);
        },
      };
      const buffer = new TelemetryBuffer("lease-writes", undefined, {
        rpc: offlineRpc,
        durable,
        getAuth: auth,
        locks: null,
        tally: null,
      });

      await buffer.start();
      expect(stamps).toEqual([{ owner: expect.stringMatching(/^recording:/), kind: "recording", expiresAtMs: Date.now() + RECORDING_LEASE_MS }]);

      // Nothing to write for a while: the lease is renewed before it runs out.
      await vi.advanceTimersByTimeAsync(RECORDING_LEASE_RENEW_MS);
      expect(stamps).toHaveLength(2);
      expect(stamps[1]?.expiresAtMs).toBe(Date.now() + RECORDING_LEASE_MS);

      buffer.pushFrame(row(0));
      await vi.advanceTimersByTimeAsync(1000);
      expect(metas.at(-1)?.lease).toMatchObject({ owner: stamps[0]?.owner, kind: "recording" });

      await buffer.stop({ budgetMs: 0 });
      expect(metas.at(-1)?.lease).toBeNull();
      const stampsAtStop = stamps.length;
      await vi.advanceTimersByTimeAsync(RECORDING_LEASE_RENEW_MS * 3);
      expect(stamps).toHaveLength(stampsAtStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it("without Web Locks a lease left by a tab that closed mid-recording holds the record only until it expires", async () => {
    const dbName = unique("db");
    const sessionId = unique("session");
    let clock = 1_000_000;
    const orphaned: RecordLease = {
      owner: "recording:closed-tab:1",
      kind: "recording",
      expiresAtMs: clock + RECORDING_LEASE_MS,
    };
    await new DurableQueue(dbName).save(sessionId, rows(20), [], { ownerId: USER, lease: orphaned });

    const calls: FlushRpcArgs[] = [];
    const outbox = createTelemetryOutbox({
      rpc: async (args) => {
        calls.push(args);
        return ok(args);
      },
      store: new DurableQueue(dbName),
      getUserId: async () => USER,
      isSessionActive: () => false,
      locks: null,
      tally: noTally,
      pageLoadId: unique("page"),
      now: () => clock,
      sleep: async () => undefined,
    });

    expect(await outbox.drain()).toMatchObject({ sent: 0, remaining: 20 });
    expect(calls).toHaveLength(0);

    clock += RECORDING_LEASE_MS;
    expect(await outbox.drain()).toMatchObject({ sent: 20, remaining: 0 });
    expect(await new DurableQueue(dbName).read(sessionId)).toBeNull();
  });
});
