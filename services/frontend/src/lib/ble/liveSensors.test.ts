import { describe, expect, it, vi } from "vitest";

import type { ConnectDeviceOptions, SensorConnection, SensorConnectionHandlers } from "./connectSensor";
import {
  BATTERY_READ_INTERVAL_MS,
  DELIVERED_RATE_WINDOW_MS,
  FrameTimeRing,
  LiveSensorError,
  MANUAL_SAME_DEVICE_TIMEOUT_MS,
  RECONNECT_GIVE_UP_MS,
  RateMeter,
  STATUS_TICK_MS,
  bindingsFromDeviceRows,
  createLiveSensorsStore,
  deriveLink,
  findBindingConflict,
  nextReconnectStep,
  planBinding,
  reconnectDelayMs,
  shortDeviceId,
  type BindingRow,
  type LiveSensorsDeps,
} from "./liveSensors";
import type { BatteryReadResult, SampleRateResult } from "./sampleRate";
import type { SupportedRateHz } from "./witRegister";
import type { ParsedWt901Frame } from "./wt901ble68";

const FRAME: ParsedWt901Frame = { accelerometerRaw: [0, 0, 0], gyroscopeRaw: [0, 0, 0], eulerDegrees: [0, 10, 0] };

function rateResult(hz: SupportedRateHz): SampleRateResult {
  const code = hz === 100 ? 0x09 : 0x08;
  return {
    requestedHz: hz,
    requestedCode: code,
    readbackCode: code,
    confirmed: true,
    attempts: 1,
    failure: null,
    errorMessage: null,
    finishedAt: 0,
  };
}

const BATTERY_OK: BatteryReadResult = { ok: true, rawValue: 392, volts: 3.92, vendorPercent: 72.5, attempts: 1 };
const BATTERY_NO_REPLY: BatteryReadResult = {
  ok: false,
  failure: "no_reply",
  rawValue: null,
  errorMessage: null,
  attempts: 2,
};

const OUTAGE_ATTEMPT_STARTS_MS = [
  1000, 3000, 7000, 15_000, 25_000, 35_000, 45_000, 55_000, 65_000, 75_000, 85_000, 95_000, 105_000, 115_000, 120_000,
];

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

describe("FrameTimeRing", () => {
  it("is unknown until the window has passed since the first frame, then counts the frames inside it", () => {
    const ring = new FrameTimeRing();
    for (let t = 20; t <= 30_000; t += 20) ring.push(t);
    expect(ring.count(30_000, 30_000)).toBeNull();
    ring.push(30_020);
    expect(ring.count(30_020, 30_000)).toBe(1500);
    expect(ring.count(30_020, 60_000)).toBeNull();
  });

  it("lets frames leave the window when the sensor goes quiet", () => {
    const ring = new FrameTimeRing();
    for (let t = 0; t <= 60_000; t += 10) ring.push(t);
    expect(ring.count(60_000, 60_000)).toBe(6000);
    expect(ring.count(75_000, 30_000)).toBe(1500);
    expect(ring.count(200_000, 60_000)).toBe(0);
  });

  it("is bounded: once full, the oldest times are overwritten", () => {
    const ring = new FrameTimeRing(100);
    for (let t = 1; t <= 1000; t += 1) ring.push(t);
    expect(ring.count(1000, 500)).toBe(100);
    expect(ring.count(1000, 50)).toBe(50);
    ring.reset();
    expect(ring.count(1000, 1)).toBeNull();
  });
});

describe("reconnect backoff", () => {
  it("waits 1, 2, 4, 8, then 10 s between attempts", () => {
    expect([0, 1, 2, 3, 4, 5, 12].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000, 10_000]);
  });

  it("plans attempts for up to 120 s after the drop, pulls the last one in to the deadline, then gives up", () => {
    const droppedAt = 5_000;
    const starts: number[] = [];
    let now = droppedAt;
    for (let made = 0; ; made += 1) {
      const step = nextReconnectStep(droppedAt, made, now);
      if (step.kind === "give_up") break;
      now = step.atMs; // the attempt starts and fails at once
      starts.push(now - droppedAt);
    }
    expect(starts).toEqual(OUTAGE_ATTEMPT_STARTS_MS);
    expect(now - droppedAt).toBe(RECONNECT_GIVE_UP_MS);
  });

  it("gives up when a slow attempt fails past the deadline", () => {
    expect(nextReconnectStep(0, 3, RECONNECT_GIVE_UP_MS + 1)).toEqual({ kind: "give_up" });
    expect(nextReconnectStep(0, 3, 119_000)).toEqual({ kind: "wait", atMs: RECONNECT_GIVE_UP_MS });
  });
});

describe("shortDeviceId", () => {
  it("keeps the last six characters", () => {
    expect(shortDeviceId("q7Xk2P+aZ/9dLw==")).toBe("9dLw==");
    expect(shortDeviceId("abc")).toBe("abc");
    expect(shortDeviceId(null)).toBeNull();
  });
});

describe("deriveLink", () => {
  const base = { supported: true, previous: "disconnected" as const, now: 10_000 };

  it("maps phases", () => {
    expect(deriveLink({ ...base, supported: false, phase: "connected", lastFrameAt: 9_999 })).toBe("unsupported");
    expect(deriveLink({ ...base, phase: "idle", lastFrameAt: null })).toBe("disconnected");
    expect(deriveLink({ ...base, phase: "requesting", lastFrameAt: null })).toBe("connecting");
    expect(deriveLink({ ...base, phase: "reconnecting", lastFrameAt: 9_000 })).toBe("connecting");
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

describe("findBindingConflict / planBinding", () => {
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
    expect(planBinding("thigh", "left", "dev-a", {}, saved)).toEqual({ conflict: null, replaces: [] });
  });

  it("lets the same role take a device saved on the other leg, and marks that row to be replaced", () => {
    const saved = [{ role: "thigh" as const, side: "left" as const, deviceId: "dev-a", deviceName: null }];
    expect(planBinding("thigh", "right", "dev-a", {}, saved)).toEqual({ conflict: null, replaces: saved });
    // With the side unknown nothing is saved, so nothing is replaced.
    expect(planBinding("thigh", null, "dev-a", {}, saved)).toEqual({ conflict: null, replaces: [] });
  });

  it("still refuses a device saved for another role on the other leg", () => {
    const saved = [{ role: "shank" as const, side: "left" as const, deviceId: "dev-a", deviceName: null }];
    expect(findBindingConflict("thigh", "dev-a", {}, saved, "right")).toEqual({
      kind: "saved",
      otherRole: "shank",
      side: "left",
    });
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A store wired to fake devices, a manual clock and a manual ticker. */
function harness({ supported = true }: { supported?: boolean } = {}) {
  let now = 1_000_000;
  let tick: (() => void) | null = null;
  let requests = 0;
  let activation = true;
  let nextDevice: { id: string; name?: string } | Error = { id: "dev-1", name: "WT901BLE68" };
  const handlers = new Map<string, SensorConnectionHandlers>();
  const disconnected: string[] = [];
  const persisted: BindingRow[] = [];
  const replaced: (readonly string[])[] = [];
  const connects: { deviceId: string; at: number; timeoutMs: number | undefined }[] = [];
  const rateRequests: (SupportedRateHz | undefined)[] = [];
  const protocol: string[] = [];
  /** Consumed one per connect call; an empty queue connects. */
  const outcomes: Error[] = [];
  const batteryResults: BatteryReadResult[] = [];

  const deps: LiveSensorsDeps = {
    isSupported: () => supported,
    requestDevice: async () => {
      requests += 1;
      if (nextDevice instanceof Error) throw nextDevice;
      return nextDevice as unknown as BluetoothDevice;
    },
    connectDevice: async (device, deviceHandlers, options?: ConnectDeviceOptions): Promise<SensorConnection> => {
      connects.push({ deviceId: device.id, at: now, timeoutMs: options?.timeoutMs });
      const failure = outcomes.shift();
      if (failure) throw failure;
      handlers.set(device.id, deviceHandlers);
      return {
        deviceId: device.id,
        deviceName: device.name ?? null,
        configureSampleRate: async (hz) => {
          rateRequests.push(hz);
          protocol.push(`rate:${hz}`);
          return rateResult(hz ?? 50);
        },
        readBattery: async () => {
          protocol.push("battery");
          return batteryResults.shift() ?? BATTERY_OK;
        },
        disconnect: () => disconnected.push(device.id),
      };
    },
    persistBinding: async (row, replacedRoles) => {
      persisted.push(row);
      replaced.push(replacedRoles);
      return null;
    },
    hasUserActivation: () => activation,
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
    replaced,
    connects,
    rateRequests,
    protocol,
    outcomes,
    batteryResults,
    requests: () => requests,
    now: () => now,
    setActivation: (value: boolean) => {
      activation = value;
    },
    pick: (device: { id: string; name?: string } | Error) => {
      nextDevice = device;
    },
    advance: (ms: number) => {
      now += ms;
      tick?.();
    },
    /** Let time pass tick by tick, settling async work after each tick. */
    elapse: async (ms: number) => {
      for (let elapsed = 0; elapsed < ms; elapsed += STATUS_TICK_MS) {
        now += STATUS_TICK_MS;
        tick?.();
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
    stream: (deviceId: string, hz: number, ms: number) => {
      const step = 1000 / hz;
      for (let elapsed = 0; elapsed < ms; elapsed += step) {
        now += step;
        handlers.get(deviceId)?.onFrame(FRAME, new Uint8Array(20));
      }
      tick?.();
    },
    /** The link drops without the app asking for it. */
    drop: (deviceId: string) => handlers.get(deviceId)?.onStatusChange?.("disconnected"),
    hasTicker: () => tick !== null,
  };
}

const RIGHT = { patientId: "p1", side: "right" as const };

describe("live sensors store", () => {
  it("connects a role, configures the rate, reads the battery, saves the binding and measures the delivered rate", async () => {
    const h = harness();
    const seen: [string, number][] = [];
    h.store.subscribeFrames((role, _frame, at) => seen.push([role, at]));
    const connectedAt = h.now();

    const state = await h.store.connectRole("thigh", RIGHT);
    expect(state.link).toBe("connecting");
    await flush();

    let thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.rate).toEqual({ status: "done", result: rateResult(50) });
    expect(thigh.rateHistory).toEqual([{ ...rateResult(50), atMs: connectedAt }]);
    expect(thigh.requestedHz).toBe(50);
    expect(thigh.battery).toEqual({ volts: 3.92, vendorPercent: 72.5, atMs: connectedAt });
    expect(thigh.batteryError).toBeNull();
    expect(h.protocol).toEqual(["rate:50", "battery"]);
    expect(thigh.persistence).toEqual({ status: "saved" });
    expect(thigh.deviceIdShort).toBe("dev-1");
    expect(h.persisted).toEqual([
      expect.objectContaining({ patient_id: "p1", role: "r_thigh", device_id: "dev-1", device_name: "WT901BLE68" }),
    ]);
    expect(h.replaced).toEqual([[]]);

    h.stream("dev-1", 50, DELIVERED_RATE_WINDOW_MS + 500);
    thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.link).toBe("streaming");
    expect(thigh.deliveredHz).toBeCloseTo(50, 0);
    expect(thigh.framesReceived).toBe(125);
    expect(thigh.framesTotal).toBe(125);
    expect(thigh.framesLast30s).toBeNull();
    expect(thigh.connectedForMs).toBe(2500);
    expect(thigh.reconnect).toEqual({ state: "idle", attempts: 0, nextAttemptAtMs: null, succeeded: 0 });
    expect(seen[0][0]).toBe("thigh");
    expect(h.store.getSnapshot().active).toBe(true);
    expect(h.store.getSnapshot().allStreaming).toBe(false);
  });

  it("counts frames over rolling 30 s and 60 s windows, with the total and the time connected", async () => {
    const h = harness();
    await h.store.connectRole("thigh", RIGHT);
    await flush();

    h.stream("dev-1", 50, 29_000);
    let thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.framesLast30s).toBeNull();
    expect(thigh.framesTotal).toBe(1450);

    h.stream("dev-1", 50, 2_000);
    thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.framesLast30s).toBe(1500);
    expect(thigh.framesLast60s).toBeNull();
    expect(thigh.connectedForMs).toBe(31_000);

    h.stream("dev-1", 50, 30_000);
    thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.framesLast30s).toBe(1500);
    expect(thigh.framesLast60s).toBe(3000);
    expect(thigh.framesTotal).toBe(3050);
  });

  it("refuses a device already bound to another role in this session, before connecting it", async () => {
    const h = harness();
    await h.store.connectRole("thigh", RIGHT);

    const attempt = h.store.connectRole("shank", RIGHT);
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
    await expect(h.store.connectRole("thigh", { ...RIGHT, savedBindings: saved })).rejects.toMatchObject({
      code: "device_saved_for_other_role",
    });

    h.pick({ id: "dev-2" });
    await h.store.connectRole("shank", RIGHT);
    await flush();
    h.store.disconnectRole("shank");
    await expect(h.store.connectRole("foot", RIGHT)).rejects.toMatchObject({
      code: "device_saved_for_other_role",
    });
  });

  it("replaces the other leg's row when the same role binds its device on this leg, and remembers the removal", async () => {
    const h = harness();
    const saved = [{ role: "thigh" as const, side: "left" as const, deviceId: "dev-1", deviceName: "WT901BLE68" }];

    await h.store.connectRole("thigh", { ...RIGHT, savedBindings: saved });
    await flush();
    expect(h.persisted.at(-1)).toMatchObject({ role: "r_thigh", device_id: "dev-1" });
    expect(h.replaced.at(-1)).toEqual(["l_thigh"]);
    expect(h.store.getSnapshot().roles.thigh.persistence).toEqual({ status: "saved" });

    // The page still passes the old left-leg row, but this session removed it and saved the right one instead.
    h.store.disconnectRole("thigh");
    await h.store.connectRole("thigh", { patientId: "p1", side: "left", savedBindings: saved });
    await flush();
    expect(h.replaced.at(-1)).toEqual(["r_thigh"]);
  });

  it("keeps the binding in session only when the side is unknown", async () => {
    const h = harness();
    await h.store.connectRole("foot", { patientId: "p1", side: null });
    await flush();

    expect(h.store.getSnapshot().roles.foot.persistence).toEqual({ status: "session_only", reason: "side_unknown" });
    expect(h.persisted).toHaveLength(0);
  });

  it("leaves a role free to retry after a connect that failed or timed out", async () => {
    const h = harness();
    h.outcomes.push(Object.assign(new Error("GATT connection did not complete within 15 s"), { name: "TimeoutError" }));

    await expect(h.store.connectRole("foot", RIGHT)).rejects.toMatchObject({ code: "connect_failed" });
    const foot = h.store.getSnapshot().roles.foot;
    expect(foot).toMatchObject({ link: "disconnected", deviceId: null });
    expect(foot.lastError?.detail).toContain("15 s");

    await h.store.connectRole("foot", RIGHT);
    expect(h.store.getSnapshot().roles.foot.link).toBe("connecting");
  });

  it("marks a role lost after two silent seconds, reconnecting after a dropped link, and disconnected after disconnectRole", async () => {
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

    h.drop("dev-1");
    const dropped = h.store.getSnapshot().roles.thigh;
    expect(dropped.link).toBe("connecting");
    expect(dropped.reconnect.state).toBe("reconnecting");
    expect(dropped.deliveredHz).toBeNull();
    expect(dropped.lastError?.code).toBe("connection_dropped");
    expect(h.hasTicker()).toBe(true);

    h.store.disconnectRole("thigh");
    expect(h.store.getSnapshot().roles.thigh).toMatchObject({
      link: "disconnected",
      deviceId: null,
      lastError: null,
      reconnect: { state: "idle", attempts: 0, nextAttemptAtMs: null, succeeded: 0 },
    });
    expect(h.hasTicker()).toBe(false);
    await h.elapse(5000);
    expect(h.connects).toHaveLength(1);
  });

  it("reconnects the same device without the chooser after a drop, applying the requested rate and reading the battery again", async () => {
    const h = harness();
    h.store.setRequestedRate(100);
    await h.store.connectRole("thigh", RIGHT);
    await flush();
    h.stream("dev-1", 100, 3000);
    expect(h.rateRequests).toEqual([100]);

    h.outcomes.push(new Error("Bluetooth Device is no longer in range."));
    h.drop("dev-1");
    let thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.link).toBe("connecting");
    expect(thigh.reconnect).toEqual({ state: "reconnecting", attempts: 0, nextAttemptAtMs: h.now() + 1000, succeeded: 0 });

    await h.elapse(1000); // the first attempt fails
    thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.reconnect).toEqual({ state: "reconnecting", attempts: 1, nextAttemptAtMs: h.now() + 2000, succeeded: 0 });
    expect(thigh.link).toBe("connecting");

    await h.elapse(2000); // the second one gets the link back
    thigh = h.store.getSnapshot().roles.thigh;
    expect(h.connects.map((c) => [c.deviceId, c.timeoutMs])).toEqual([
      ["dev-1", undefined],
      ["dev-1", undefined],
      ["dev-1", undefined],
    ]);
    expect(h.requests()).toBe(1);
    expect(thigh.reconnect).toEqual({ state: "idle", attempts: 2, nextAttemptAtMs: null, succeeded: 1 });
    expect(thigh.lastError).toBeNull();
    expect(thigh.link).toBe("connecting"); // no frame on the new link yet
    expect(h.rateRequests).toEqual([100, 100]);
    expect(thigh.rateHistory.map((entry) => entry.requestedHz)).toEqual([100, 100]);
    expect(h.protocol).toEqual(["rate:100", "battery", "rate:100", "battery"]);
    expect(thigh.deliveredHz).toBeNull(); // the delivered-rate window starts again
    expect(thigh.framesTotal).toBe(300); // frames from before the drop still count
    expect(thigh.connectedForMs).toBe(3000);

    h.stream("dev-1", 100, DELIVERED_RATE_WINDOW_MS + 500);
    thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.link).toBe("streaming");
    expect(thigh.deliveredHz).toBeCloseTo(100, 0);
    expect(thigh.framesTotal).toBe(550);
  });

  it("gives up 120 s after the drop and leaves the role lost; a press then tries the same device before the chooser", async () => {
    const h = harness();
    await h.store.connectRole("thigh", RIGHT);
    await flush();
    h.stream("dev-1", 50, 1000);
    const droppedAt = h.now();
    for (let i = 0; i < 40; i += 1) h.outcomes.push(new Error("Bluetooth Device is no longer in range."));

    h.drop("dev-1");
    await h.elapse(RECONNECT_GIVE_UP_MS + 10_000);

    const thigh = h.store.getSnapshot().roles.thigh;
    expect(h.connects.slice(1).map((c) => c.at - droppedAt)).toEqual(OUTAGE_ATTEMPT_STARTS_MS);
    expect(thigh.link).toBe("lost");
    expect(thigh.reconnect).toEqual({ state: "gave_up", attempts: 15, nextAttemptAtMs: null, succeeded: 0 });
    expect(thigh.lastError?.code).toBe("connection_dropped");
    expect(h.hasTicker()).toBe(false);
    expect(h.requests()).toBe(1);

    h.outcomes.length = 0;
    h.outcomes.push(new Error("Still out of range"));
    const state = await h.store.connectRole("thigh", RIGHT);
    expect(h.connects.slice(-2).map((c) => c.timeoutMs)).toEqual([MANUAL_SAME_DEVICE_TIMEOUT_MS, undefined]);
    expect(h.requests()).toBe(2);
    // The chooser returned the same sensor, so its record carries on.
    expect(state.reconnect).toEqual({ state: "idle", attempts: 16, nextAttemptAtMs: null, succeeded: 0 });
    expect(state.framesTotal).toBe(50);
  });

  it("a press during an outage reconnects the same device without the chooser when it answers", async () => {
    const h = harness();
    await h.store.connectRole("shank", RIGHT);
    await flush();
    h.stream("dev-1", 50, 500);
    h.drop("dev-1");

    const state = await h.store.connectRole("shank", RIGHT);

    expect(h.requests()).toBe(1);
    expect(h.connects.at(-1)?.timeoutMs).toBe(MANUAL_SAME_DEVICE_TIMEOUT_MS);
    expect(state.reconnect).toEqual({ state: "idle", attempts: 1, nextAttemptAtMs: null, succeeded: 1 });
  });

  it("when a pressed same-device attempt fails after the click went stale, the next press opens the chooser", async () => {
    const h = harness();
    await h.store.connectRole("shank", RIGHT);
    await flush();
    h.stream("dev-1", 50, 500);
    h.outcomes.push(new Error("Bluetooth Device is no longer in range."));
    h.drop("dev-1");

    h.setActivation(false);
    await expect(h.store.connectRole("shank", RIGHT)).rejects.toMatchObject({ code: "connect_failed" });
    expect(h.requests()).toBe(1);
    const shank = h.store.getSnapshot().roles.shank;
    expect(shank.reconnect.state).toBe("reconnecting"); // the outage keeps its own schedule
    expect(shank.lastError?.code).toBe("connect_failed");

    h.setActivation(true);
    await h.store.connectRole("shank", RIGHT);
    expect(h.requests()).toBe(2);
    expect(h.connects.at(-1)?.timeoutMs).toBeUndefined();
  });

  it("reads the battery again every 60 s while streaming; a failed read is recorded, never guessed", async () => {
    const h = harness();
    h.batteryResults.push(BATTERY_NO_REPLY);
    await h.store.connectRole("thigh", RIGHT);
    await flush();

    let thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.battery).toBeNull();
    expect(thigh.batteryError).toBe("no_reply");

    h.stream("dev-1", 50, BATTERY_READ_INTERVAL_MS);
    await flush();
    thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.battery).toEqual({ volts: 3.92, vendorPercent: 72.5, atMs: h.now() });
    expect(thigh.batteryError).toBeNull();

    const readAt = h.now();
    h.batteryResults.push({ ok: false, failure: "implausible_value", rawValue: 0, errorMessage: null, attempts: 2 });
    h.stream("dev-1", 50, BATTERY_READ_INTERVAL_MS);
    await flush();
    thigh = h.store.getSnapshot().roles.thigh;
    expect(thigh.batteryError).toBe("implausible_value");
    // The earlier reading stays, dated by its own atMs.
    expect(thigh.battery).toEqual({ volts: 3.92, vendorPercent: 72.5, atMs: readAt });
    expect(h.protocol).toEqual(["rate:50", "battery", "battery", "battery"]);
  });

  it("applies a changed requested rate to connected roles at once, and treats anything but 100 as 50", async () => {
    const h = harness();
    await h.store.connectRole("thigh", RIGHT);
    await flush();
    expect(h.store.getSnapshot().roles.thigh.requestedHz).toBe(50);

    h.store.setRequestedRate(100);
    expect(h.store.getSnapshot().roles.thigh.rate).toEqual({ status: "configuring", requestedHz: 100 });
    await flush();
    expect(h.rateRequests).toEqual([50, 100]);
    expect(h.store.getSnapshot().roles.foot.requestedHz).toBe(100);

    h.store.setRequestedRate(100);
    h.store.setRequestedRate(70 as SupportedRateHz);
    await flush();
    expect(h.store.getRequestedRate()).toBe(50);
    expect(h.rateRequests).toEqual([50, 100, 50]);
  });

  it("treats a closed chooser as a cancel, leaving state untouched", async () => {
    const h = harness();
    const cancel = Object.assign(new Error("User cancelled the requestDevice() chooser."), { name: "NotFoundError" });
    h.pick(cancel);

    await expect(h.store.connectRole("shank", RIGHT)).rejects.toMatchObject({
      code: "chooser_cancelled",
    });
    expect(h.store.getSnapshot().roles.shank).toMatchObject({ link: "disconnected", lastError: null });
  });

  it("reports unsupported browsers on every role and refuses to connect", async () => {
    const h = harness({ supported: false });
    const snapshot = h.store.getSnapshot();
    expect(Object.values(snapshot.roles).map((r) => r.link)).toEqual(["unsupported", "unsupported", "unsupported"]);
    expect(snapshot.active).toBe(false);
    await expect(h.store.connectRole("thigh", RIGHT)).rejects.toMatchObject({
      code: "unsupported",
    });
  });

  it("publishes a stable snapshot between changes and notifies subscribers on change", async () => {
    const h = harness();
    const listener = vi.fn();
    h.store.subscribe(listener);
    const before = h.store.getSnapshot();
    expect(h.store.getSnapshot()).toBe(before);

    await h.store.connectRole("thigh", RIGHT);
    expect(listener).toHaveBeenCalled();
    expect(h.store.getSnapshot()).not.toBe(before);
    await flush();

    const settled = h.store.getSnapshot();
    const calls = listener.mock.calls.length;
    h.advance(0);
    h.advance(0);
    expect(listener.mock.calls.length).toBe(calls); // nothing changed, nothing published
    expect(h.store.getSnapshot()).toBe(settled);

    h.advance(STATUS_TICK_MS);
    expect(h.store.getSnapshot().roles.foot).toBe(settled.roles.foot);
  });

  it("disconnectAll releases every connection and stops the ticker", async () => {
    const h = harness();
    h.pick({ id: "dev-1" });
    await h.store.connectRole("thigh", RIGHT);
    h.pick({ id: "dev-2" });
    await h.store.connectRole("shank", RIGHT);

    h.store.disconnectAll();

    expect(h.disconnected.sort()).toEqual(["dev-1", "dev-2"]);
    expect(h.hasTicker()).toBe(false);
    expect(h.store.getSnapshot().active).toBe(false);
  });
});
