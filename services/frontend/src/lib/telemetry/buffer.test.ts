import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FLUSH_FRAMES,
  MAX_BATCH_FRAMES,
  MAX_BUFFER,
  STOP_DELIVERY_BUDGET_MS,
  STOP_RETRY_DELAYS_MS,
  TelemetryBuffer,
  keepaliveBody,
  skippedCounts,
  type FlushRpc,
  type FlushRpcArgs,
  type FogEventRow,
  type FrameRow,
} from "./buffer";
import { isSessionActive, subscribeOutbox } from "./outboxRegistry";

function row(seq: number): FrameRow {
  return { recorded_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, seq)).toISOString(), seq, imu: { role: "thigh" } };
}

const range = (count: number) => Array.from({ length: count }, (_, i) => i);

type DurableWrite = { kind: "save"; seqs: number[] } | { kind: "clear" };

function fakeDurable() {
  const writes: DurableWrite[] = [];
  return {
    writes,
    save: vi.fn(async (_session: string, frames: FrameRow[]) => {
      writes.push({ kind: "save", seqs: frames.map((f) => f.seq) });
    }),
    load: vi.fn(async () => null),
    clear: vi.fn(async () => {
      writes.push({ kind: "clear" });
    }),
  };
}

/** An RPC whose calls can be answered one by one. */
function controlledRpc() {
  const calls: { args: FlushRpcArgs; settle: (ok: boolean) => void }[] = [];
  const rpc: FlushRpc = (args) =>
    new Promise((resolve) => {
      calls.push({
        args,
        settle: (ok) =>
          resolve(
            ok
              ? { data: { frames: args.p_frames.length, events: args.p_events.length }, error: null }
              : { data: null, error: { message: "Failed to fetch" } },
          ),
      });
    });
  return { rpc, calls };
}

const okRpc = (): { rpc: FlushRpc; sent: number[][] } => {
  const sent: number[][] = [];
  return {
    sent,
    rpc: async (args) => {
      sent.push(args.p_frames.map((f) => f.seq));
      return { data: { frames: args.p_frames.length, events: args.p_events.length }, error: null };
    },
  };
};

const offlineRpc = () => {
  const calls = { count: 0 };
  const rpc: FlushRpc = async () => {
    calls.count += 1;
    return { data: null, error: { message: "offline" } };
  };
  return { rpc, calls };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TelemetryBuffer", () => {
  it("throttles durable writes to about one a second at 150 rows/s, then drains and clears on stop", async () => {
    const durable = fakeDurable();
    const { rpc, sent } = okRpc();
    const buffer = new TelemetryBuffer("s1", undefined, { rpc, durable, getAuth: async () => null });
    await buffer.start();

    for (let seq = 0; seq < 450; seq += 1) {
      buffer.pushFrame(row(seq));
      await vi.advanceTimersByTimeAsync(1000 / 150);
    }

    // 450 pushes over three seconds: a write per push would be 450.
    expect(durable.writes.length).toBeGreaterThan(0);
    expect(durable.writes.length).toBeLessThanOrEqual(4);

    await buffer.stop();
    expect(sent.flat()).toEqual(range(450));
    expect(sent.every((batch) => batch.length <= MAX_BATCH_FRAMES)).toBe(true);
    expect(buffer.counters).toMatchObject({
      framesSent: 450,
      framesConfirmed: 450,
      pending: 0,
      errors: 0,
      framesDropped: 0,
    });
    expect(durable.writes.at(-1)).toEqual({ kind: "clear" });
  });

  it("keeps queued and in-flight rows in the durable record, and re-queues a failed batch in order", async () => {
    const durable = fakeDurable();
    const { rpc, calls } = controlledRpc();
    const buffer = new TelemetryBuffer("s1", undefined, { rpc, durable, getAuth: async () => null });
    await buffer.start();

    for (let seq = 0; seq < FLUSH_FRAMES + 10; seq += 1) buffer.pushFrame(row(seq));
    expect(calls).toHaveLength(1);
    expect(calls[0].args.p_frames).toHaveLength(FLUSH_FRAMES);

    await vi.advanceTimersByTimeAsync(1000);
    expect(durable.writes.at(-1)).toEqual({ kind: "save", seqs: range(160) });

    calls[0].settle(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(buffer.counters).toMatchObject({ errors: 1, lastError: "Failed to fetch", pending: 160, framesSent: 0 });

    // The timer retries with the re-queued rows first.
    await vi.advanceTimersByTimeAsync(1000);
    const retried = calls.at(-1);
    expect(retried?.args.p_frames.map((f) => f.seq)).toEqual(range(160));
  });

  it("drains a backlog in bounded batches on stop", async () => {
    const durable = fakeDurable();
    let online = false;
    const sent: number[][] = [];
    const rpc: FlushRpc = async (args) => {
      if (!online) return { data: null, error: { message: "offline" } };
      sent.push(args.p_frames.map((f) => f.seq));
      return { data: { frames: args.p_frames.length, events: 0 }, error: null };
    };
    const buffer = new TelemetryBuffer("s1", undefined, { rpc, durable, getAuth: async () => null });
    await buffer.start();

    for (let seq = 0; seq < 2000; seq += 1) buffer.pushFrame(row(seq));
    await vi.advanceTimersByTimeAsync(0);
    expect(buffer.counters.pending).toBe(2000);

    online = true;
    await buffer.stop();

    expect(sent.length).toBeGreaterThanOrEqual(Math.ceil(2000 / MAX_BATCH_FRAMES));
    expect(sent.every((batch) => batch.length <= MAX_BATCH_FRAMES)).toBe(true);
    expect(sent.flat()).toEqual(range(2000));
    expect(buffer.counters.pending).toBe(0);
    expect(durable.writes.at(-1)).toEqual({ kind: "clear" });
  });

  it("retries with backoff on stop and finishes once the network answers within the budget", async () => {
    const durable = fakeDurable();
    let failuresLeft = 2;
    const sent: number[][] = [];
    const rpc: FlushRpc = async (args) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return { data: null, error: { message: "Failed to fetch" } };
      }
      sent.push(args.p_frames.map((f) => f.seq));
      return { data: { frames: args.p_frames.length, events: 0 }, error: null };
    };
    const buffer = new TelemetryBuffer("stop-retry", undefined, { rpc, durable, getAuth: async () => null });
    await buffer.start();
    for (let seq = 0; seq < 40; seq += 1) buffer.pushFrame(row(seq));

    const stopping = buffer.stop();
    await vi.advanceTimersByTimeAsync(STOP_RETRY_DELAYS_MS[0] + STOP_RETRY_DELAYS_MS[1]);
    await stopping;

    expect(sent.flat()).toEqual(range(40));
    expect(buffer.counters).toMatchObject({ pending: 0, errors: 2, framesConfirmed: 40 });
    expect(durable.writes.at(-1)).toEqual({ kind: "clear" });
  });

  it("gives up on stop after its time budget while offline and leaves the rows in the durable record", async () => {
    const durable = fakeDurable();
    const { rpc, calls } = offlineRpc();
    const buffer = new TelemetryBuffer("stop-offline", undefined, { rpc, durable, getAuth: async () => null });
    await buffer.start();

    for (let seq = 0; seq < 20; seq += 1) buffer.pushFrame(row(seq));
    let done = false;
    const stopping = buffer.stop().then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(STOP_DELIVERY_BUDGET_MS - 100);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await stopping;

    // Attempts at 0, 0.5, 1.5, 3.5 and 7.5 s; the next wait would pass the budget.
    expect(calls.count).toBe(5);
    expect(buffer.counters.pending).toBe(20);
    expect(durable.writes.at(-1)).toEqual({ kind: "save", seqs: range(20) });
  });

  it("does not wait past the budget for a request that never answers", async () => {
    const durable = fakeDurable();
    const { rpc, calls } = controlledRpc(); // never answered
    const buffer = new TelemetryBuffer("stop-hang", undefined, { rpc, durable, getAuth: async () => null });
    await buffer.start();
    for (let seq = 0; seq < 20; seq += 1) buffer.pushFrame(row(seq));

    let done = false;
    const stopping = buffer.stop().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(STOP_DELIVERY_BUDGET_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;

    expect(calls).toHaveLength(1);
    expect(buffer.counters.pending).toBe(20);
    expect(durable.writes.at(-1)).toEqual({ kind: "save", seqs: range(20) });
  });

  it("marks its session active until stop and tells the outbox when rows are left", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOutbox(listener);
    try {
      const left = new TelemetryBuffer("registry-left", undefined, {
        rpc: offlineRpc().rpc,
        durable: fakeDurable(),
        getAuth: async () => null,
      });
      await left.start();
      expect(isSessionActive("registry-left")).toBe(true);
      left.pushFrame(row(0));
      await left.stop({ budgetMs: 0 });
      expect(isSessionActive("registry-left")).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);

      const clean = new TelemetryBuffer("registry-clean", undefined, {
        rpc: okRpc().rpc,
        durable: fakeDurable(),
        getAuth: async () => null,
      });
      await clean.start();
      clean.pushFrame(row(0));
      await clean.stop();
      expect(isSessionActive("registry-clean")).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("counts rows a keepalive already stored as confirmed once a flush acknowledges them, and tracks keepalive rows apart", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    // The keepalive request stored the rows, so the later flush inserts nothing and answers frames: 0.
    const rpc: FlushRpc = async () => ({ data: { frames: 0, events: 0 }, error: null });
    const buffer = new TelemetryBuffer("keepalive", undefined, {
      rpc,
      durable: fakeDurable(),
      getAuth: async () => ({ url: "https://db.test", key: "anon", token: "jwt", userId: "user-1" }),
    });
    await buffer.start();
    for (let seq = 0; seq < 140; seq += 1) buffer.pushFrame(row(seq));

    const hide = (buffer as unknown as { onUnload: () => void }).onUnload;
    hide();
    hide(); // a second hide resends the same rows; they are counted once
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(buffer.counters).toMatchObject({ framesKeepaliveSent: 140, framesConfirmed: 0, pending: 140 });

    await buffer.stop();
    expect(buffer.counters).toMatchObject({
      framesConfirmed: 140,
      framesSent: 140,
      framesKeepaliveSent: 140,
      pending: 0,
    });
  });

  it("counts rows the server skipped as delivered but not confirmed", async () => {
    const rpc: FlushRpc = async (args) => ({
      data: { frames: args.p_frames.length - 5, events: 0, skipped: 5 },
      error: null,
    });
    const buffer = new TelemetryBuffer("skipped", undefined, { rpc, durable: fakeDurable(), getAuth: async () => null });
    await buffer.start();
    for (let seq = 0; seq < 30; seq += 1) buffer.pushFrame(row(seq));
    await buffer.stop();

    expect(buffer.counters).toMatchObject({ pending: 0, errors: 0, framesConfirmed: 25, framesSkipped: 5 });
  });

  it("adds skipped rows to the session's tally only after the durable write that drops them", async () => {
    const log: string[] = [];
    const durable = {
      save: vi.fn(async () => {
        log.push("save");
      }),
      load: vi.fn(async () => null),
      clear: vi.fn(async () => {
        log.push("clear");
      }),
    };
    const tally = {
      add: vi.fn(async (sessionId: string, counts: { frames: number; events: number }) => {
        log.push(`tally ${sessionId} ${counts.frames}/${counts.events}`);
      }),
    };
    const rpc: FlushRpc = async (args) => ({
      data: { frames: args.p_frames.length - 5, events: 0, skipped: 5, skipped_events: 0 },
      error: null,
    });
    const buffer = new TelemetryBuffer("skipped-tally", undefined, {
      rpc,
      durable,
      getAuth: async () => null,
      locks: null,
      tally,
    });
    await buffer.start();
    for (let seq = 0; seq < 30; seq += 1) buffer.pushFrame(row(seq));
    await buffer.stop();

    expect(tally.add).toHaveBeenCalledTimes(1);
    expect(log.slice(-2)).toEqual(["clear", "tally skipped-tally 5/0"]);
  });

  it("recovers rows a previous instance left behind, ahead of new ones", async () => {
    const durable = fakeDurable();
    durable.load.mockResolvedValueOnce({ sessionId: "s1", frames: [row(0), row(1)], events: [], savedAt: "" } as never);
    const { rpc, sent } = okRpc();
    const buffer = new TelemetryBuffer("s1", undefined, { rpc, durable, getAuth: async () => null });
    await buffer.start();

    buffer.pushFrame(row(2));
    await buffer.stop();

    expect(sent.flat()).toEqual([0, 1, 2]);
  });

  it("drops the oldest rows past the cap and counts them", async () => {
    const durable = fakeDurable();
    const { rpc } = controlledRpc(); // never answered: everything stays queued
    const buffer = new TelemetryBuffer("s1", undefined, { rpc, durable, getAuth: async () => null });
    await buffer.start();

    const total = FLUSH_FRAMES + MAX_BUFFER + 1_501;
    for (let seq = 0; seq < total; seq += 1) buffer.pushFrame(row(seq));

    expect(buffer.counters.framesDropped).toBe(1_501);
    expect(buffer.counters.pending).toBe(FLUSH_FRAMES + MAX_BUFFER);
  });

  it("throttles counter updates while rows stream in", async () => {
    const updates: number[] = [];
    const { rpc } = controlledRpc();
    const buffer = new TelemetryBuffer("s1", (c) => updates.push(c.pending), {
      rpc,
      durable: fakeDurable(),
      getAuth: async () => null,
    });
    await buffer.start();

    for (let seq = 0; seq < 100; seq += 1) {
      buffer.pushFrame(row(seq));
      await vi.advanceTimersByTimeAsync(5);
    }

    expect(updates.length).toBeLessThanOrEqual(3);
  });
});

describe("skippedCounts", () => {
  it("reads one number (frames first) or a frames/events object, and clamps to the batch", () => {
    expect(skippedCounts({ frames: 3, skipped: 4 }, 3, 2)).toEqual({ frames: 3, events: 1 });
    expect(skippedCounts({ skipped: { frames: 2, events: 9 } }, 10, 1)).toEqual({ frames: 2, events: 1 });
    expect(skippedCounts({ frames: 10, events: 0 }, 10, 0)).toEqual({ frames: 0, events: 0 });
    expect(skippedCounts({ skipped: -2 }, 10, 0)).toEqual({ frames: 0, events: 0 });
    expect(skippedCounts(null, 10, 0)).toEqual({ frames: 0, events: 0 });
  });

  it("reads 0034's answer: skipped counts frames only and skipped_events counts events", () => {
    const answer = { frames: 7, events: 0, skipped: 3, skipped_events: 2 };
    expect(skippedCounts(answer, 10, 2)).toEqual({ frames: 3, events: 2 });
    // A frame count larger than the batch does not spill into events when skipped_events is present.
    expect(skippedCounts({ skipped: 12, skipped_events: 0 }, 10, 2)).toEqual({ frames: 10, events: 0 });
    expect(skippedCounts({ skipped: 0, skipped_events: 5 }, 10, 1)).toEqual({ frames: 0, events: 1 });
  });
});

describe("keepaliveBody", () => {
  const event: FogEventRow = {
    kind: "episode",
    started_at: "2026-01-01T00:00:00.000Z",
    ended_at: null,
    confidence: 0.9,
    freeze_index: null,
    source: "test",
  };

  it("sends everything when it fits", () => {
    const body = keepaliveBody("s1", [row(0), row(1)], [event]);
    expect(JSON.parse(body ?? "{}")).toMatchObject({ p_session: "s1", p_events: [event] });
    expect(JSON.parse(body ?? "{}").p_frames).toHaveLength(2);
  });

  it("trims to the oldest rows that fit under the byte cap", () => {
    const frames = Array.from({ length: 1000 }, (_, i) => row(i));
    const body = keepaliveBody("s1", frames, [], 20_000);
    expect(body).not.toBeNull();
    expect(new TextEncoder().encode(body ?? "").length).toBeLessThanOrEqual(20_000);
    const sentSeqs = (JSON.parse(body ?? "{}").p_frames as FrameRow[]).map((f) => f.seq);
    expect(sentSeqs.length).toBeGreaterThan(0);
    expect(sentSeqs).toEqual(range(sentSeqs.length));
  });

  it("returns null when not even the events fit", () => {
    expect(keepaliveBody("s1", [row(0)], [event], 10)).toBeNull();
  });
});
