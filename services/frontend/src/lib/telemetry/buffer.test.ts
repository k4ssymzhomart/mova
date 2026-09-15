import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FLUSH_FRAMES,
  MAX_BATCH_FRAMES,
  MAX_BUFFER,
  TelemetryBuffer,
  keepaliveBody,
  type FlushRpc,
  type FlushRpcArgs,
  type FogEventRow,
  type FrameRow,
} from "./buffer";

function row(seq: number): FrameRow {
  return { recorded_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, seq)).toISOString(), seq, imu: { role: "thigh" } };
}

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

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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
    expect(sent.flat()).toEqual(Array.from({ length: 450 }, (_, i) => i));
    expect(sent.every((batch) => batch.length <= MAX_BATCH_FRAMES)).toBe(true);
    expect(buffer.counters).toMatchObject({ framesSent: 450, pending: 0, errors: 0, framesDropped: 0 });
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
    expect(durable.writes.at(-1)).toEqual({ kind: "save", seqs: Array.from({ length: 160 }, (_, i) => i) });

    calls[0].settle(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(buffer.counters).toMatchObject({ errors: 1, lastError: "Failed to fetch", pending: 160, framesSent: 0 });

    // The timer retries with the re-queued rows first.
    await vi.advanceTimersByTimeAsync(1000);
    const retried = calls.at(-1);
    expect(retried?.args.p_frames.map((f) => f.seq)).toEqual(Array.from({ length: 160 }, (_, i) => i));
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
    expect(sent.flat()).toEqual(Array.from({ length: 2000 }, (_, i) => i));
    expect(buffer.counters.pending).toBe(0);
    expect(durable.writes.at(-1)).toEqual({ kind: "clear" });
  });

  it("gives up draining on stop while offline and leaves the rows in the durable record", async () => {
    const durable = fakeDurable();
    const rpc: FlushRpc = async () => ({ data: null, error: { message: "offline" } });
    const buffer = new TelemetryBuffer("s1", undefined, { rpc, durable, getAuth: async () => null });
    await buffer.start();

    for (let seq = 0; seq < 20; seq += 1) buffer.pushFrame(row(seq));
    await buffer.stop();

    expect(buffer.counters.pending).toBe(20);
    expect(durable.writes.at(-1)).toEqual({ kind: "save", seqs: Array.from({ length: 20 }, (_, i) => i) });
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
    expect(sentSeqs).toEqual(Array.from({ length: sentSeqs.length }, (_, i) => i));
  });

  it("returns null when not even the events fit", () => {
    expect(keepaliveBody("s1", [row(0)], [event], 10)).toBeNull();
  });
});
