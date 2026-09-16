/// <reference types="web-bluetooth" />
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPairer, createProxyOrienter, proxyPitchDeg } from "@/lib/motion/flexion";
import { MAX_REP_GAP_MS, createRepCounter, heelSlideThresholds } from "@/lib/motion/reps";

import { connectWt901Device } from "./connectSensor";
import { createLiveSensorsStore } from "./liveSensors";
import { SENSOR_ROLE_ORDER, type SensorRole } from "./roles";
import {
  CONNECT_DELAY_MS,
  SCRIPT_DURATION_MS,
  SCRIPT_PEAKS_DEG,
  SCRIPT_REPS,
  SIMULATED_DEVICE_ID,
  createSensorSimulation,
  encodeRegisterReply,
  scriptedBendDeg,
  simulatedFrame,
  type SimulationClock,
} from "./simulatedWt901";
import {
  WIT_WRITE_CHARACTERISTIC_UUID,
  WitRegisterReplyBuffer,
  parseRegisterReply,
  readRegisterCommand,
  setReturnRateCommand,
  unlockCommand,
} from "./witRegister";
import {
  WT901BLE68_CHARACTERISTIC_UUID,
  WT901BLE68_SERVICE_UUID,
  WitMotion61FrameBuffer,
  parseWt901Frame,
} from "./wt901ble68";

/** The fake timers vitest installs, read at call time. */
const FAKE_TIMER_CLOCK: SimulationClock = {
  now: () => Date.now(),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
};

/** A clock whose interval fires only when the test says, at whatever irregular times it picks. */
function manualClock() {
  let now = 0;
  let interval: (() => void) | null = null;
  let timeouts: { at: number; callback: () => void }[] = [];
  const clock: SimulationClock = {
    now: () => now,
    setInterval: (callback) => {
      interval = callback;
      return 1;
    },
    clearInterval: () => {
      interval = null;
    },
    setTimeout: (callback, ms) => {
      timeouts.push({ at: now + ms, callback });
      return timeouts.length;
    },
  };
  return {
    clock,
    /** Move time forward; due timeouts run, then the interval fires once. */
    step(ms: number) {
      now += ms;
      const due = timeouts.filter((timeout) => timeout.at <= now);
      timeouts = timeouts.filter((timeout) => timeout.at > now);
      for (const timeout of due) timeout.callback();
      interval?.();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("simulated frames", () => {
  it("are 20-byte 55 61 frames the verbatim buffer and parser read back as the scripted pose", () => {
    const buffer = new WitMotion61FrameBuffer();
    const rest = simulatedFrame("thigh", null);
    const bent = simulatedFrame("shank", 1000 + 1000 + 1500 + 200); // the hold of the first rep
    expect(rest).toHaveLength(20);
    expect([rest[0], rest[1]]).toEqual([0x55, 0x61]);

    // Split across notifications, the way chunks can arrive.
    const bytes = Uint8Array.from([...rest, ...bent]);
    const frames = [...buffer.feed(bytes.subarray(0, 27)), ...buffer.feed(bytes.subarray(27))];
    expect(frames).toHaveLength(2);

    const [thigh, shank] = frames.map(parseWt901Frame);
    expect(thigh.eulerDegrees[1]).toBeCloseTo(2, 0);
    expect(shank.eulerDegrees[1]).toBeCloseTo(-1 - 0.55 * SCRIPT_PEAKS_DEG[0], 0);
    // Lying still: gravity along z, about one g at the ±16 g scale.
    expect(Math.hypot(...thigh.accelerometerRaw)).toBeGreaterThan(2000);
    expect(Math.hypot(...thigh.accelerometerRaw)).toBeLessThan(2100);
  });

  it("answer a read of register 0x03 with a 55 71 reply the register buffer extracts", () => {
    const replies = new WitRegisterReplyBuffer().feed(
      Uint8Array.from([...simulatedFrame("foot", null), ...encodeRegisterReply(0x03, [0x09, 0, 0, 0])]),
    );
    expect(replies).toHaveLength(1);
    expect(parseRegisterReply(replies[0])).toEqual({ register: 0x03, values: [0x09, 0, 0, 0] });
  });
});

describe("simulated device over the real connection", () => {
  it("confirms 50 and 100 Hz by readback, streams at the confirmed rate and never answers the battery read", async () => {
    vi.useFakeTimers();
    const simulation = createSensorSimulation(FAKE_TIMER_CLOCK);
    const received: number[] = [];
    const connecting = connectWt901Device(simulation.device("thigh"), { onFrame: () => received.push(Date.now()) });
    await vi.advanceTimersByTimeAsync(CONNECT_DELAY_MS);
    const connection = await connecting;
    expect(connection.deviceId).toBe(SIMULATED_DEVICE_ID.thigh);

    const fifty = connection.configureSampleRate(50);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(fifty).resolves.toMatchObject({ confirmed: true, readbackCode: 0x08, attempts: 1, failure: null });

    received.length = 0;
    await vi.advanceTimersByTimeAsync(2000);
    expect(received.length).toBeGreaterThanOrEqual(99);
    expect(received.length).toBeLessThanOrEqual(101);

    const hundred = connection.configureSampleRate(100);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(hundred).resolves.toMatchObject({ confirmed: true, readbackCode: 0x09, attempts: 1 });

    received.length = 0;
    await vi.advanceTimersByTimeAsync(2000);
    expect(received.length).toBeGreaterThanOrEqual(199);
    expect(received.length).toBeLessThanOrEqual(201);

    const battery = connection.readBattery();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(battery).resolves.toMatchObject({ ok: false, failure: "no_reply" });

    connection.disconnect();
    received.length = 0;
    await vi.advanceTimersByTimeAsync(1000);
    expect(received).toHaveLength(0);
  });

  it("keeps the rate when the timer fires late and unevenly, and ignores a rate write without an unlock", async () => {
    const { clock, step } = manualClock();
    const device = createSensorSimulation(clock).device("shank");
    const gatt = device.gatt as BluetoothRemoteGATTServer;
    const connecting = gatt.connect();
    step(CONNECT_DELAY_MS);
    const service = await (await connecting).getPrimaryService(WT901BLE68_SERVICE_UUID);
    const notify = await service.getCharacteristic(WT901BLE68_CHARACTERISTIC_UUID);
    const writer = await service.getCharacteristic(WIT_WRITE_CHARACTERISTIC_UUID);
    const buffer = new WitMotion61FrameBuffer();
    const replies = new WitRegisterReplyBuffer();
    let frames = 0;
    const codes: number[] = [];
    notify.addEventListener("characteristicvaluechanged", () => {
      const value = notify.value as DataView;
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      frames += buffer.feed(bytes).length;
      for (const reply of replies.feed(bytes)) codes.push(parseRegisterReply(reply).values[0]);
    });
    await notify.startNotifications();

    const jitter = [3, 17, 9, 31, 5, 22, 13, 40, 1, 19];
    const run = (ms: number) => {
      for (let elapsed = 0, i = 0; elapsed < ms; i += 1) {
        const next = Math.min(jitter[i % jitter.length], ms - elapsed);
        step(next);
        elapsed += next;
      }
    };
    run(10_000);
    expect(frames).toBeGreaterThanOrEqual(499);
    expect(frames).toBeLessThanOrEqual(501);

    await writer.writeValueWithoutResponse(setReturnRateCommand(0x09));
    await writer.writeValueWithoutResponse(readRegisterCommand(0x03));
    run(100);
    expect(codes).toEqual([0x08]);

    await writer.writeValueWithoutResponse(unlockCommand());
    await writer.writeValueWithoutResponse(setReturnRateCommand(0x09));
    await writer.writeValueWithoutResponse(readRegisterCommand(0x03));
    frames = 0;
    run(10_000);
    expect(codes).toEqual([0x08, 0x09]);
    expect(frames).toBeGreaterThanOrEqual(999);
    expect(frames).toBeLessThanOrEqual(1001);

    // Battery register: no reply at all.
    await writer.writeValueWithoutResponse(readRegisterCommand(0x64));
    run(1000);
    expect(codes).toEqual([0x08, 0x09]);
  });
});

describe("the heel slide script", () => {
  it("peaks between 60 and 80 on every rep and rests before, between and after", () => {
    expect(SCRIPT_PEAKS_DEG).toHaveLength(SCRIPT_REPS);
    for (const peak of SCRIPT_PEAKS_DEG) {
      expect(peak).toBeGreaterThan(60);
      expect(peak).toBeLessThan(80);
    }
    expect(scriptedBendDeg(null)).toBe(0);
    expect(scriptedBendDeg(999)).toBe(0);
    expect(scriptedBendDeg(SCRIPT_DURATION_MS + 1)).toBe(0);
  });

  it("counts exactly ten reps through the real parser, flexion proxy and rep counter at 50 Hz", async () => {
    vi.useFakeTimers();
    const simulation = createSensorSimulation(FAKE_TIMER_CLOCK);
    const pairer = createPairer();
    const orienter = createProxyOrienter();
    const counter = createRepCounter({
      ...heelSlideThresholds({ min_valid_excursion_deg: 22.5 }),
      maxGapMs: MAX_REP_GAP_MS,
    });
    let armed = false;
    let counting = false;
    let maxAbsAngle = 0;
    let lowestAfterReps = Infinity;

    // The exercise screen's pipeline (HeelSlideExercise onFrame): movement starts once the zero is taken.
    const onFrame = (role: SensorRole, eulerDegrees: readonly number[]) => {
      for (const angle of eulerDegrees) maxAbsAngle = Math.max(maxAbsAngle, Math.abs(angle));
      if (!armed) return;
      const pair = pairer.push(role, Date.now(), proxyPitchDeg(eulerDegrees));
      if (!pair) return;
      const value = orienter.push(pair.tMs, pair.relativeDeg);
      if (value === null) return;
      counter.push(pair.tMs, value);
      if (!counting) {
        counting = true;
        simulation.startMovement();
      }
      if (counter.count === SCRIPT_REPS) lowestAfterReps = Math.min(lowestAfterReps, value);
    };

    const connections = [];
    for (const role of SENSOR_ROLE_ORDER) {
      const connecting = connectWt901Device(simulation.device(role), {
        onFrame: (frame) => onFrame(role, frame.eulerDegrees),
      });
      await vi.advanceTimersByTimeAsync(CONNECT_DELAY_MS);
      connections.push(await connecting);
    }
    const rates = Promise.all(connections.map((connection) => connection.configureSampleRate(50)));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await rates).every((rate) => rate.confirmed)).toBe(true);

    armed = true;
    vi.advanceTimersByTime(1500);
    expect(counting).toBe(true);
    expect(counter.count).toBe(0);
    vi.advanceTimersByTime(20_000);
    // A second start while the script runs changes nothing.
    simulation.startMovement();
    vi.advanceTimersByTime(SCRIPT_DURATION_MS - 20_000 + 3000);

    expect(counter.count).toBe(10);
    for (const segment of counter.segments) {
      expect(segment.peakValue).toBeGreaterThan(59);
      expect(segment.peakValue).toBeLessThan(81);
    }
    expect(lowestAfterReps).toBeLessThan(7);
    expect(counter.phase).toBe("rest");
    expect(maxAbsAngle).toBeLessThan(90);
    for (const connection of connections) connection.disconnect();
  });
});

describe("the live store on simulated devices", () => {
  it("connects each role without a chooser, confirms the rate, leaves the battery unknown and saves no binding", async () => {
    vi.useFakeTimers();
    const simulation = createSensorSimulation(FAKE_TIMER_CLOCK);
    const persistBinding = vi.fn(async () => null);
    const store = createLiveSensorsStore({
      isSupported: () => true,
      requestDevice: async (role) => simulation.device(role),
      connectDevice: connectWt901Device,
      persistBinding,
      hasUserActivation: () => false,
      now: () => Date.now(),
      setInterval: (callback, ms) => setInterval(callback, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
      simulated: true,
    });

    for (const role of SENSOR_ROLE_ORDER) {
      const connected = store.connectRole(role, { patientId: "patient-1", side: "right", savedBindings: [] });
      await vi.advanceTimersByTimeAsync(CONNECT_DELAY_MS);
      await connected;
    }
    await vi.advanceTimersByTimeAsync(6000);

    const snapshot = store.getSnapshot();
    expect(snapshot.allStreaming).toBe(true);
    for (const role of SENSOR_ROLE_ORDER) {
      const state = snapshot.roles[role];
      expect(state.deviceId).toBe(SIMULATED_DEVICE_ID[role]);
      expect(state.rate).toMatchObject({ status: "done", result: { confirmed: true, readbackCode: 0x08 } });
      expect(state.deliveredHz).toBeGreaterThanOrEqual(49.5);
      expect(state.deliveredHz).toBeLessThanOrEqual(50.5);
      expect(state.battery).toBeNull();
      expect(state.batteryError).toBe("no_reply");
      expect(state.persistence).toEqual({ status: "session_only", reason: "simulated" });
    }
    expect(persistBinding).not.toHaveBeenCalled();
    store.disconnectAll();
  });
});
