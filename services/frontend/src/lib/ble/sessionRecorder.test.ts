import { describe, expect, it, vi } from "vitest";

import {
  STOP_DELIVERY_BUDGET_MS,
  TelemetryBuffer,
  type BufferCounters,
  type FlushRpc,
  type FrameRow,
} from "@/lib/telemetry/buffer";

import { BleSessionRecorder, type RecorderBuffer } from "./sessionRecorder";
import type { ParsedWt901Frame } from "./wt901ble68";

const FRAME: ParsedWt901Frame = {
  accelerometerRaw: [-831, -272, 1562],
  gyroscopeRaw: [700, 135, 167],
  eulerDegrees: [1, 2, 3],
};

function fakeBuffers() {
  const created: { sessionId: string; rows: FrameRow[]; log: string[] }[] = [];
  const createBuffer = (sessionId: string): RecorderBuffer => {
    const record = { sessionId, rows: [] as FrameRow[], log: [] as string[] };
    created.push(record);
    const counters: BufferCounters = { framesSent: 0, eventsSent: 0, pending: 0, errors: 0, lastError: null };
    return {
      counters,
      async start() {
        record.log.push("start");
      },
      async stop() {
        record.log.push("stop");
        counters.framesSent = record.rows.length;
      },
      pushFrame(row) {
        record.rows.push(row);
      },
    };
  };
  return { created, createBuffer };
}

describe("BleSessionRecorder", () => {
  it("numbers rows with one session-wide seq across roles and stamps the receive time", async () => {
    const { created, createBuffer } = fakeBuffers();
    const recorder = new BleSessionRecorder({ createBuffer });
    await recorder.start("session-1");

    const t0 = Date.UTC(2026, 8, 15, 10, 0, 0);
    recorder.recordFrame("thigh", FRAME, t0);
    recorder.recordFrame("shank", FRAME, t0);
    recorder.recordFrame("foot", FRAME, t0 + 7);

    const rows = created[0].rows;
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2]);
    expect(rows.map((r) => (r.imu as { role: string }).role)).toEqual(["thigh", "shank", "foot"]);
    expect(rows[1].recorded_at).toBe(new Date(t0).toISOString());
    expect(rows[2].recorded_at).toBe(new Date(t0 + 7).toISOString());
    expect(recorder.framesRecorded).toBe(3);
  });

  it("marks every row as simulated when recording the development simulation", async () => {
    const { created, createBuffer } = fakeBuffers();
    const recorder = new BleSessionRecorder({ createBuffer, simulated: true });
    await recorder.start("session-1");
    const t0 = Date.UTC(2026, 8, 15, 10, 0, 0);
    for (const role of ["thigh", "shank", "foot"] as const) recorder.recordFrame(role, FRAME, t0);
    for (let i = 0; i < 1500; i += 1) recorder.recordFrame("thigh", FRAME, t0 + i * 20);

    expect(created[0].rows.every((row) => (row.imu as { origin?: string }).origin === "simulated")).toBe(true);
  });

  it("evaluates quality at most once a second and attaches the report only at that tick", async () => {
    const { created, createBuffer } = fakeBuffers();
    const recorder = new BleSessionRecorder({ createBuffer });
    await recorder.start("session-1");

    const t0 = 1_000_000;
    // 3 roles at 50 Hz for 2.5 s.
    for (let i = 0; i < 125; i += 1) {
      for (const role of ["thigh", "shank", "foot"] as const) recorder.recordFrame(role, FRAME, t0 + i * 20);
    }

    const rows = created[0].rows;
    const withReport = rows.filter((r) => "signal_quality" in (r.imu as object));
    expect(withReport.map((r) => r.recorded_at)).toEqual([
      new Date(t0).toISOString(),
      new Date(t0 + 1000).toISOString(),
      new Date(t0 + 2000).toISOString(),
    ]);
    // Every row carries the latest rollup once an evaluation exists.
    expect(rows.every((r) => typeof r.quality === "number")).toBe(true);
    expect(recorder.lastQuality).not.toBeNull();
  });

  it("ignores frames outside a recording and returns final counters from stop", async () => {
    const { created, createBuffer } = fakeBuffers();
    const recorder = new BleSessionRecorder({ createBuffer });

    recorder.recordFrame("thigh", FRAME, 1);
    expect(await recorder.stop()).toBeNull();

    await recorder.start("session-1");
    recorder.recordFrame("thigh", FRAME, 2);
    const counters = await recorder.stop();
    recorder.recordFrame("thigh", FRAME, 3);

    expect(created).toHaveLength(1);
    expect(created[0].rows).toHaveLength(1);
    // A buffer that only reports the older framesSent name still yields every field.
    expect(counters).toEqual({
      framesSent: 1,
      framesConfirmed: 1,
      framesSkipped: 0,
      framesKeepaliveSent: 0,
      framesDropped: 0,
      eventsSent: 0,
      pending: 0,
      errors: 0,
      lastError: null,
    });
  });

  it("stop keeps trying for its time budget, then returns the counters and leaves the rows for the outbox", async () => {
    vi.useFakeTimers();
    try {
      const saved: number[][] = [];
      const durable = {
        save: async (_session: string, frames: FrameRow[]) => {
          saved.push(frames.map((f) => f.seq));
        },
        load: async () => null,
        clear: async () => undefined,
      };
      let calls = 0;
      const rpc: FlushRpc = async () => {
        calls += 1;
        return { data: null, error: { message: "Failed to fetch" } };
      };
      const recorder = new BleSessionRecorder({
        createBuffer: (sessionId, onUpdate) =>
          new TelemetryBuffer(sessionId, onUpdate, { rpc, durable, getAuth: async () => null }),
      });
      await recorder.start("session-offline");
      for (let i = 0; i < 3; i += 1) recorder.recordFrame("thigh", FRAME, 1_000 + i * 20);

      let counters: Awaited<ReturnType<BleSessionRecorder["stop"]>> | undefined;
      const stopping = recorder.stop().then((result) => {
        counters = result;
      });
      await vi.advanceTimersByTimeAsync(STOP_DELIVERY_BUDGET_MS - 1_000);
      expect(counters).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1_500);
      await stopping;

      expect(calls).toBeGreaterThan(1);
      expect(counters).toMatchObject({ pending: 3, framesConfirmed: 0, framesSent: 0 });
      expect(counters?.errors).toBe(calls);
      expect(saved.at(-1)).toEqual([0, 1, 2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes start/stop/start so buffers never overlap", async () => {
    const { created, createBuffer } = fakeBuffers();
    const recorder = new BleSessionRecorder({ createBuffer });

    const first = recorder.start("session-1");
    const stopped = recorder.stop();
    const second = recorder.start("session-1");
    await Promise.all([first, stopped, second]);
    recorder.recordFrame("thigh", FRAME, 5);

    expect(created.map((b) => b.log)).toEqual([["start", "stop"], ["start"]]);
    expect(created[1].rows.map((r) => r.seq)).toEqual([0]);
  });
});
