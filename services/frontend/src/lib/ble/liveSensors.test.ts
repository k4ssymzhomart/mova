import { describe, expect, it, vi } from "vitest";

import type { SensorConnection, SensorConnectionHandlers } from "./connectSensor";
import {
  DELIVERED_RATE_WINDOW_MS,
  LiveSensorError,
  RateMeter,
  STATUS_TICK_MS,
  bindingsFromDeviceRows,
  createLiveSensorsStore,
  deriveLink,
  findBindingConflict,
  type BindingRow,
  type LiveSensorsDeps,
} from "./liveSensors";
import type { SampleRateResult } from "./sampleRate";
import type { ParsedWt901Frame } from "./wt901ble68";

const FRAME: ParsedWt901Frame = { accelerometerRaw: [0, 0, 0], gyroscopeRaw: [0, 0, 0], eulerDegrees: [0, 10, 0] };

const CONFIRMED: SampleRateResult = {
  requestedHz: 50,
  requestedCode: 0x08,
  readbackCode: 0x08,
  confirmed: true,
  attempts: 1,
  failure: null,
  errorMessage: null,
  finishedAt: 0,
};

describe("RateMeter", () => {
  it("is unknown until a full window is observed, then reports frames per second", () => {
    const meter = new RateMeter(2000);
    for (let t = 0; t < 1000; t += 20) meter.push(t);
    expect(meter.hz(1000)).toBeNull();
    for (let t = 1000; t <= 3000; t += 20) meter.push(t);
    expect(meter.hz(3000)).toBe(50);
  });

  it("falls to zero when frames stop", () => {
    const meter = new RateMeter(2000);
    for (let t = 0; t <= 2000; t += 20) meter.push(t);
    expect(meter.hz(4100)).toBe(0);
  });
});

describe("deriveLink", () => {
  const base = { supported: true, previous: "disconnected" as const, now: 10_000 };

  it("maps phases", () => {
    expect(deriveLink({ ...base, supported: false, phase: "connected", lastFrameAt: 9_999 })).toBe("unsupported");
    expect(deriveLink({ ...base, phase: "idle", lastFrameAt: null })).toBe("disconnected");
    expect(deriveLink({ ...base, phase: "requesting", lastFrameAt: null })).toBe("connecting");
    expect(deriveLink({ ...base, phase: "connected", lastFrameAt: null })).toBe("connecting");
    expect(deriveLink({ ...base, phase: "dropped", lastFrameAt: 9_000 })).toBe("lost");
    expect(deriveLink({ ...base, phase: "dropped", lastFrameAt: null })).toBe("disconnected");
  });

  it("streams on a fresh frame, holds through a short gap, and is lost after two silent seconds", () => {
    expect(deriveLink({ ...base, phase: "connected", lastFrameAt: 9_000 })).toBe("streaming");
    expect(deriveLink({ ...base, phase: "connected", previous: "streaming", lastFrameAt: 8_500 })).toBe("streaming");
    expect(deriveLink({ ...base, phase: "connected", previous: "lost", lastFrameAt: 8_500 })).toBe("lost");
    expect(deriveLink({ ...base, phase: "connected", previous: "streaming", lastFrameAt: 7_999 })).toBe("lost");
  });
});

describe("findBindingConflict", () => {
  it("refuses a device held by another role in this session", () => {
    expect(findBindingConflict("shank", "dev-a", { thigh: "dev-a" }, [])).toEqual({ kind: "session", otherRole: "thigh" });
  });

  it("refuses a device saved for another role", () => {
    const saved = [{ role: "foot" as const, side: "right" as const, deviceId: "dev-a", deviceName: "WT-3" }];
    expect(findBindingConflict("thigh", "dev-a", {}, saved)).toEqual({ kind: "saved", otherRole: "foot", side: "right" });
  });

  it("allows the same role to take its own device again", () => {
    const saved = [{ role: "thigh" as const, side: "left" as const, deviceId: "dev-a", deviceName: null }];
    expect(findBindingConflict("thigh", "dev-a", { thigh: "dev-a" }, saved)).toBeNull();
  });
});

describe("bindingsFromDeviceRows", () => {
  it("parses lateralized body sites and skips anything else", () => {
    expect(
      bindingsFromDeviceRows([
        { role: "l_shank", device_id: "d1", device_name: "WT901BLE68" },
        { role: "r_foot", device_id: "d2", device_name: null },
        { role: "l_hand", device_id: "d3", device_name: null },
      ]),
    ).toEqual([
      { role: "shank", side: "left", deviceId: "d1", deviceName: "WT901BLE68" },
      { role: "foot", side: "right", deviceId: "d2", deviceName: null },
    ]);
  });
});

/** A store wired to fake devices, a manual clock and a manual ticker. */
function harness({ supported = true }: { supported?: boolean } = {}) {
  let now = 1_000_000;
  let tick: (() => void) | null = null;
  const handlers = new Map<string, SensorConnectionHandlers>();
  const disconnected: string[] = [];
  const persisted: BindingRow[] = [];
  let nextDevice: { id: string; name?: string } | Error = { id: "dev-1", name: "WT901BLE68" };

  const deps: LiveSensorsDeps = {
    isSupported: () => supported,
    requestDevice: async () => {
      if (nextDevice instanceof Error) throw nextDevice;
      return nextDevice as unknown as BluetoothDevice;
    },
    connectDevice: async (device, deviceHandlers): Promise<SensorConnection> => {
      handlers.set(device.id, deviceHandlers);
      return {
        deviceId: device.id,
        deviceName: device.name ?? null,
        configureSampleRate: async () => CONFIRMED,
        disconnect: () => disconnected.push(device.id),
      };
    },
    persistBinding: async (row) => {
      persisted.push(row);
      return null;
    },
    now: () => now,
    setInterval: (callback) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {
      tick = null;
    },
  };

  const store = createLiveSensorsStore(deps);
  return {
    store,
    handlers,
    disconnected,
    persisted,
    pick: (device: { id: string; name?: string } | Error) => {
      nextDevice = device;
    },
    advance: (ms: number) => {
      now += ms;
      tick?.();
    },
    stream: (deviceId: string, hz: number, ms: number) => {
      const step = 1000 / hz;
      for (let elapsed = 0; elapsed < ms; elapsed += step) {
        now += step;
        handlers.get(deviceId)?.onFrame(FRAME, new Uint8Array(20));
      }
      tick?.();
    },
    hasTicker: () => tick !== null,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("live sensors store", () => {
  it("connects a role, configures the rate, saves the binding and measures the delivered rate", async () => {
    const h = harness();
    const seen: [string, number][] = [];
    h.store.subscribeFrames((role, _frame, at) => seen.push([role, at]));

    const state = await h.store.connectRole("thigh", { patientId: "p1", side: "right" });
    expect(state.link).toBe("connecting");
    await flush();

    let thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.rate).toEqual({ status: "done", result: CONFIRMED });
    expect(thigh.persistence).toEqual({ status: "saved" });
    expect(h.persisted).toEqual([
      expect.objectContaining({ patient_id: "p1", role: "r_thigh", device_id: "dev-1", device_name: "WT901BLE68" }),
    ]);

    h.stream("dev-1", 50, DELIVERED_RATE_WINDOW_MS + 500);
    thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.link).toBe("streaming");
    expect(thigh.deliveredHz).toBeCloseTo(50, 0);
    expect(thigh.framesReceived).toBe(125);
    expect(seen[0][0]).toBe("thigh");
    expect(h.store.getSnapshot().active).toBe(true);
    expect(h.store.getSnapshot().allStreaming).toBe(false);
  });

  it("refuses a device already bound to another role in this session, before connecting it", async () => {
    const h = harness();
    await h.store.connectRole("thigh", { patientId: "p1", side: "right" });

    const attempt = h.store.connectRole("shank", { patientId: "p1", side: "right" });
    await expect(attempt).rejects.toBeInstanceOf(LiveSensorError);
    await expect(attempt).rejects.toMatchObject({ code: "device_bound_to_other_role" });

    const shank = h.store.getSnapshot().roles.shank;
    expect(shank.lastError).toMatchObject({ code: "device_bound_to_other_role", otherRole: "thigh" });
    expect(shank.link).toBe("disconnected");
    expect(h.handlers.size).toBe(1);
  });

  it("refuses a device saved for another role, including one saved earlier in this session", async () => {
    const h = harness();
    const saved = [{ role: "foot" as const, side: "right" as const, deviceId: "dev-9", deviceName: null }];
    h.pick({ id: "dev-9" });
    await expect(h.store.connectRole("thigh", { patientId: "p1", side: "right", savedBindings: saved })).rejects.toMatchObject({
      code: "device_saved_for_other_role",
    });

    h.pick({ id: "dev-2" });
    await h.store.connectRole("shank", { patientId: "p1", side: "right" });
    await flush();
    h.store.disconnectRole("shank");
    await expect(h.store.connectRole("foot", { patientId: "p1", side: "right" })).rejects.toMatchObject({
      code: "device_saved_for_other_role",
    });
  });

  it("keeps the binding in session only when the side is unknown", async () => {
    const h = harness();
    await h.store.connectRole("foot", { patientId: "p1", side: null });
    await flush();

    expect(h.store.getSnapshot().roles.foot.persistence).toEqual({ status: "session_only", reason: "side_unknown" });
    expect(h.persisted).toHaveLength(0);
  });

  it("marks a role lost after two silent seconds or a dropped link, and disconnected after disconnectRole", async () => {
    const h = harness();
    await h.store.connectRole("thigh", { patientId: "p1", side: "left" });
    h.stream("dev-1", 50, 500);
    expect(h.store.getSnapshot().roles.thigh.link).toBe("streaming");

    h.advance(1500);
    expect(h.store.getSnapshot().roles.thigh.link).toBe("streaming");
    h.advance(600);
    expect(h.store.getSnapshot().roles.thigh.link).toBe("lost");
    h.stream("dev-1", 50, 100);
    expect(h.store.getSnapshot().roles.thigh.link).toBe("streaming");

    h.handlers.get("dev-1")?.onStatusChange?.("disconnected");
    const lost = h.store.getSnapshot().roles.thigh;
    expect(lost.link).toBe("lost");
    expect(lost.deliveredHz).toBeNull();
    expect(lost.lastError?.code).toBe("connection_dropped");
    expect(h.hasTicker()).toBe(false);

    h.store.disconnectRole("thigh");
    expect(h.store.getSnapshot().roles.thigh).toMatchObject({ link: "disconnected", deviceId: null, lastError: null });
  });

  it("treats a closed chooser as a cancel, leaving state untouched", async () => {
    const h = harness();
    const cancel = Object.assign(new Error("User cancelled the requestDevice() chooser."), { name: "NotFoundError" });
    h.pick(cancel);

    await expect(h.store.connectRole("shank", { patientId: "p1", side: "right" })).rejects.toMatchObject({
      code: "chooser_cancelled",
    });
    expect(h.store.getSnapshot().roles.shank).toMatchObject({ link: "disconnected", lastError: null });
  });

  it("reports unsupported browsers on every role and refuses to connect", async () => {
    const h = harness({ supported: false });
    const snapshot = h.store.getSnapshot();
    expect(Object.values(snapshot.roles).map((r) => r.link)).toEqual(["unsupported", "unsupported", "unsupported"]);
    expect(snapshot.active).toBe(false);
    await expect(h.store.connectRole("thigh", { patientId: "p1", side: "right" })).rejects.toMatchObject({
      code: "unsupported",
    });
  });

  it("publishes a stable snapshot between changes and notifies subscribers on change", async () => {
    const h = harness();
    const listener = vi.fn();
    h.store.subscribe(listener);
    const before = h.store.getSnapshot();
    expect(h.store.getSnapshot()).toBe(before);

    await h.store.connectRole("thigh", { patientId: "p1", side: "right" });
    expect(listener).toHaveBeenCalled();
    expect(h.store.getSnapshot()).not.toBe(before);

    h.advance(STATUS_TICK_MS);
    const settled = h.store.getSnapshot();
    const calls = listener.mock.calls.length;
    await flush();
    h.advance(0);
    h.advance(0);
    expect(listener.mock.calls.length - calls).toBeLessThanOrEqual(2); // rate + persistence results, nothing per tick
    expect(h.store.getSnapshot().roles.foot).toBe(settled.roles.foot);
  });

  it("disconnectAll releases every connection and stops the ticker", async () => {
    const h = harness();
    h.pick({ id: "dev-1" });
    await h.store.connectRole("thigh", { patientId: "p1", side: "right" });
    h.pick({ id: "dev-2" });
    await h.store.connectRole("shank", { patientId: "p1", side: "right" });

    h.store.disconnectAll();

    expect(h.disconnected.sort()).toEqual(["dev-1", "dev-2"]);
    expect(h.hasTicker()).toBe(false);
    expect(h.store.getSnapshot().active).toBe(false);
  });
});
