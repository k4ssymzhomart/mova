/// <reference types="web-bluetooth" />

// simulatedWt901 — three stand-in WT901BLE68 sensors for walking the Heel Slide path on `next dev` without hardware.
// Loaded only through simulation.ts, behind NODE_ENV "development" and NEXT_PUBLIC_SENSOR_SIMULATION "1".
//
// It fakes the Bluetooth device, not the sensor store: liveSensors connects a simulated device with the real
// connectWt901Device, so everything above the radio runs as it does with sensors. A device notifies 20-byte 55 61
// frames on ffe4 at its current rate, on a schedule that does not drift with timer jitter, and they are parsed by the
// unchanged WitMotion61FrameBuffer. It speaks just enough of the register protocol for the rate path to run for real:
// an unlock opens the register map for ten seconds, a rate write with code 0x08 (50 Hz) or 0x09 (100 Hz) takes effect,
// and a read of register 0x03 is answered with a 55 71 reply carrying the current code. Nothing else is answered, the
// battery register 0x64 included, so the battery stays unknown rather than showing a made-up reading.
//
// Motion. All three sensors lie still, with a little noise, until startMovement(), which the exercise screen calls when
// counting starts. Then one second of rest, ten heel slides of 4.5 s each (rest, bend, hold, straighten) and rest again.
// The bend is split between the thigh and shank pitch so that shank minus thigh moves by the rep's peak, 63 to 78:
// past the Heel Slide enter threshold (22.5) and back under exit (7). Every angle stays within ±90°.

import type { SensorRole } from "./roles";
import { WIT_RATE_REGISTER, WIT_WRITE_CHARACTERISTIC_UUID } from "./witRegister";
import { WT901BLE68_CHARACTERISTIC_UUID, WT901BLE68_SERVICE_UUID } from "./wt901ble68";

// — the motion script ————————————————————————————————————————————————————————————

export const SCRIPT_LEAD_MS = 1000;
export const SCRIPT_REPS = 10;
const CYCLE_REST_MS = 1000;
const CYCLE_BEND_MS = 1500;
const CYCLE_HOLD_MS = 500;
const CYCLE_STRAIGHTEN_MS = 1500;
export const SCRIPT_CYCLE_MS = CYCLE_REST_MS + CYCLE_BEND_MS + CYCLE_HOLD_MS + CYCLE_STRAIGHTEN_MS;
export const SCRIPT_DURATION_MS = SCRIPT_LEAD_MS + SCRIPT_REPS * SCRIPT_CYCLE_MS;

/** Each rep's peak, in degrees of shank-minus-thigh pitch. */
export const SCRIPT_PEAKS_DEG: readonly number[] = [66, 72, 63, 75, 69, 78, 64, 71, 67, 74];

/** Half-cosine ease from 0 to 1. */
function ease(fraction: number): number {
  return (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, fraction)))) / 2;
}

/** How far the scripted leg is bent `msSinceStart` after startMovement: 0 at rest, and before the script starts (null). */
export function scriptedBendDeg(msSinceStart: number | null): number {
  if (msSinceStart === null || msSinceStart < SCRIPT_LEAD_MS) return 0;
  const sinceLead = msSinceStart - SCRIPT_LEAD_MS;
  const rep = Math.floor(sinceLead / SCRIPT_CYCLE_MS);
  if (rep >= SCRIPT_REPS) return 0;
  const peak = SCRIPT_PEAKS_DEG[rep];
  let t = sinceLead - rep * SCRIPT_CYCLE_MS - CYCLE_REST_MS;
  if (t < 0) return 0;
  if (t < CYCLE_BEND_MS) return peak * ease(t / CYCLE_BEND_MS);
  t -= CYCLE_BEND_MS;
  if (t < CYCLE_HOLD_MS) return peak;
  t -= CYCLE_HOLD_MS;
  return peak * (1 - ease(t / CYCLE_STRAIGHTEN_MS));
}

/**
 * Each segment's resting Euler angles and how much of the bend its pitch takes. Thigh and shank tilt opposite ways
 * and their shares differ by exactly one, so shank pitch minus thigh pitch is the rest offset minus the bend.
 */
const SEGMENTS: Record<SensorRole, { roll: number; pitch: number; yaw: number; bendShare: number }> = {
  thigh: { roll: 1.5, pitch: 2, yaw: 14, bendShare: 0.45 },
  shank: { roll: -1, pitch: -1, yaw: 12, bendShare: -0.55 },
  foot: { roll: 0.5, pitch: -6, yaw: 10, bendShare: -0.15 },
};

export interface SimulatedPose {
  /** [roll, pitch, yaw], the order of ParsedWt901Frame.eulerDegrees. */
  eulerDeg: [number, number, number];
  pitchRateDegPerS: number;
}

/** A segment's noiseless pose `msSinceStart` after startMovement (null: not started). */
export function simulatedPose(role: SensorRole, msSinceStart: number | null): SimulatedPose {
  const segment = SEGMENTS[role];
  const bend = scriptedBendDeg(msSinceStart);
  const rate =
    msSinceStart === null ? 0 : ((scriptedBendDeg(msSinceStart + 5) - scriptedBendDeg(msSinceStart - 5)) / 10) * 1000;
  return {
    eulerDeg: [segment.roll, segment.pitch + segment.bendShare * bend, segment.yaw],
    pitchRateDegPerS: segment.bendShare * rate,
  };
}

// — frames ——————————————————————————————————————————————————————————————————————

/** Accelerometer LSB per g at the WT901's ±16 g range. */
const ACCEL_LSB_PER_G = 32768 / 16;
/** Gyroscope LSB per deg/s at its ±2000 deg/s range. */
const GYRO_LSB_PER_DPS = 32768 / 2000;
const ANGLE_NOISE_DEG = 0.2;
const ACCEL_NOISE_LSB = 6;
const GYRO_NOISE_LSB = 8;

function int16(value: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(value)));
}

/** A 20-byte 55 61 frame: accel ×3, gyro ×3, Euler ×3 (roll, pitch, yaw), int16 little-endian, as the sensor sends it. */
export function encodeDataFrame(
  accelRaw: readonly [number, number, number],
  gyroRaw: readonly [number, number, number],
  eulerDeg: readonly [number, number, number],
): Uint8Array {
  const frame = new Uint8Array(20);
  const view = new DataView(frame.buffer);
  frame[0] = 0x55;
  frame[1] = 0x61;
  const values = [...accelRaw, ...gyroRaw, ...eulerDeg.map((deg) => (deg / 180) * 32768)];
  values.forEach((value, index) => view.setInt16(2 + index * 2, int16(value), true));
  return frame;
}

/** A 20-byte 55 71 reply to a register read: the register, then four int16 values starting at it. */
export function encodeRegisterReply(register: number, values: readonly number[]): Uint8Array {
  const frame = new Uint8Array(20);
  const view = new DataView(frame.buffer);
  frame[0] = 0x55;
  frame[1] = 0x71;
  view.setUint16(2, register, true);
  for (let i = 0; i < 4; i += 1) view.setInt16(4 + i * 2, int16(values[i] ?? 0), true);
  return frame;
}

/** Small deterministic noise, seeded per device (mulberry32), centred on zero within ±amplitude. */
function createNoise(seed: number): (amplitude: number) => number {
  let state = seed >>> 0;
  return (amplitude) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    const unit = ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    return (unit * 2 - 1) * amplitude;
  };
}

/** One frame of `role` for a pose, with the gravity vector and pitch rate the sensor would report, plus noise. */
export function simulatedFrame(role: SensorRole, msSinceStart: number | null, noise = createNoise(0)): Uint8Array {
  const pose = simulatedPose(role, msSinceStart);
  const [roll, pitch, yaw] = pose.eulerDeg.map((deg) => deg + noise(ANGLE_NOISE_DEG)) as [number, number, number];
  const r = (roll * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  return encodeDataFrame(
    [
      -Math.sin(p) * ACCEL_LSB_PER_G + noise(ACCEL_NOISE_LSB),
      Math.sin(r) * Math.cos(p) * ACCEL_LSB_PER_G + noise(ACCEL_NOISE_LSB),
      Math.cos(r) * Math.cos(p) * ACCEL_LSB_PER_G + noise(ACCEL_NOISE_LSB),
    ],
    [noise(GYRO_NOISE_LSB), pose.pitchRateDegPerS * GYRO_LSB_PER_DPS + noise(GYRO_NOISE_LSB), noise(GYRO_NOISE_LSB)],
    [roll, pitch, yaw],
  );
}

// — devices ———————————————————————————————————————————————————————————————————————

export interface SimulationClock {
  now(): number;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(callback: () => void, ms: number): unknown;
}

const HZ_BY_RATE_CODE: Record<number, number> = { 0x08: 50, 0x09: 100 };
const INITIAL_HZ = 50;
/** How often the schedule is checked; frames due since the last check all go out on it. */
export const EMIT_TICK_MS = 5;
/** A stall longer than this (a hidden tab, a sleeping laptop) restarts the schedule instead of replaying it as a burst. */
export const MAX_CATCH_UP_MS = 1000;
export const CONNECT_DELAY_MS = 300;
export const REPLY_DELAY_MS = 20;
/** The WT901 locks its register map again ten seconds after an unlock. */
const UNLOCK_WINDOW_MS = 10_000;
const SEEDS: Record<SensorRole, number> = { thigh: 11, shank: 23, foot: 37 };

export const SIMULATED_DEVICE_ID: Record<SensorRole, string> = {
  thigh: "simulated-thigh",
  shank: "simulated-shank",
  foot: "simulated-foot",
};

export const SIMULATED_DEVICE_NAME: Record<SensorRole, string> = {
  thigh: "SIMULATED-THIGH",
  shank: "SIMULATED-SHANK",
  foot: "SIMULATED-FOOT",
};

class SimulatedCharacteristic extends EventTarget {
  value: DataView | undefined = undefined;

  constructor(
    readonly uuid: string,
    readonly properties: { notify: boolean; write: boolean; writeWithoutResponse: boolean },
    private readonly handlers: { onStart?: () => void; onWrite?: (bytes: Uint8Array) => void } = {},
  ) {
    super();
  }

  async startNotifications(): Promise<this> {
    this.handlers.onStart?.();
    return this;
  }

  async writeValueWithoutResponse(bytes: BufferSource): Promise<void> {
    this.handlers.onWrite?.(toBytes(bytes));
  }

  async writeValueWithResponse(bytes: BufferSource): Promise<void> {
    this.handlers.onWrite?.(toBytes(bytes));
  }

  notify(bytes: Uint8Array): void {
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

function toBytes(source: BufferSource): Uint8Array {
  if (ArrayBuffer.isView(source)) {
    return Uint8Array.from(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  }
  return Uint8Array.from(new Uint8Array(source));
}

export interface SensorSimulation {
  /** The simulated sensor for a role; the same object every time, so picking it again is the same device. */
  device(role: SensorRole): BluetoothDevice;
  /** Start the ten heel slides now. Ignored while a run is still going. */
  startMovement(): void;
}

export function createSensorSimulation(clock: SimulationClock): SensorSimulation {
  let movementStartedAt: number | null = null;
  const devices = new Map<SensorRole, BluetoothDevice>();

  function createDevice(role: SensorRole): BluetoothDevice {
    const noise = createNoise(SEEDS[role]);
    let connected = false;
    let connectAttempt = 0;
    let notifying = false;
    let timer: unknown = null;
    let periodMs = 1000 / INITIAL_HZ;
    let rateCode = 0x08;
    let nextFrameAt = 0;
    let unlockedUntil = -Infinity;

    const stopStreaming = () => {
      notifying = false;
      if (timer === null) return;
      clock.clearInterval(timer);
      timer = null;
    };

    const tick = () => {
      const now = clock.now();
      if (now - nextFrameAt > MAX_CATCH_UP_MS) nextFrameAt = now;
      // Frames keep their scheduled times, so a late timer sends what is due instead of slowing the rate down.
      while (timer !== null && nextFrameAt <= now) {
        const since = movementStartedAt === null ? null : nextFrameAt - movementStartedAt;
        nextFrameAt += periodMs;
        notifyCharacteristic.notify(simulatedFrame(role, since, noise));
      }
    };

    const onWrite = (bytes: Uint8Array) => {
      if (!connected || bytes.length !== 5 || bytes[0] !== 0xff || bytes[1] !== 0xaa) return;
      const now = clock.now();
      if (bytes[2] === 0x69 && bytes[3] === 0x88 && bytes[4] === 0xb5) {
        unlockedUntil = now + UNLOCK_WINDOW_MS;
      } else if (bytes[2] === WIT_RATE_REGISTER) {
        const hz = HZ_BY_RATE_CODE[bytes[3]];
        if (hz === undefined || now > unlockedUntil) return;
        rateCode = bytes[3];
        periodMs = 1000 / hz;
        nextFrameAt = now + periodMs;
      } else if (bytes[2] === 0x27 && bytes[3] === WIT_RATE_REGISTER) {
        const attempt = connectAttempt;
        clock.setTimeout(() => {
          if (connected && notifying && attempt === connectAttempt) {
            notifyCharacteristic.notify(encodeRegisterReply(WIT_RATE_REGISTER, [rateCode, 0, 0, 0]));
          }
        }, REPLY_DELAY_MS);
      }
      // Every other command, the battery read included, goes unanswered.
    };

    const notifyCharacteristic = new SimulatedCharacteristic(
      WT901BLE68_CHARACTERISTIC_UUID,
      { notify: true, write: false, writeWithoutResponse: false },
      {
        onStart: () => {
          if (!connected || timer !== null) return;
          notifying = true;
          nextFrameAt = clock.now();
          timer = clock.setInterval(tick, EMIT_TICK_MS);
        },
      },
    );
    const writeCharacteristic = new SimulatedCharacteristic(
      WIT_WRITE_CHARACTERISTIC_UUID,
      { notify: false, write: false, writeWithoutResponse: true },
      { onWrite },
    );

    const service = {
      uuid: WT901BLE68_SERVICE_UUID,
      getCharacteristic: async (uuid: string) => {
        if (uuid === WT901BLE68_CHARACTERISTIC_UUID) return notifyCharacteristic;
        if (uuid === WIT_WRITE_CHARACTERISTIC_UUID) return writeCharacteristic;
        throw new DOMException(`No characteristic ${uuid}`, "NotFoundError");
      },
    };

    const device = new EventTarget() as EventTarget & { id: string; name: string; gatt: unknown };
    const server = {
      device,
      get connected() {
        return connected;
      },
      getPrimaryService: async (uuid: string) => {
        if (uuid !== WT901BLE68_SERVICE_UUID) throw new DOMException(`No service ${uuid}`, "NotFoundError");
        return service;
      },
    };
    const gatt = {
      device,
      get connected() {
        return connected;
      },
      connect: () =>
        new Promise<typeof server>((resolve) => {
          const attempt = (connectAttempt += 1);
          clock.setTimeout(() => {
            // A disconnect while this was pending cancelled it; the caller has already given up on it.
            if (attempt !== connectAttempt) return;
            connected = true;
            resolve(server);
          }, CONNECT_DELAY_MS);
        }),
      disconnect: () => {
        connectAttempt += 1;
        connected = false;
        unlockedUntil = -Infinity;
        stopStreaming();
      },
    };
    device.id = SIMULATED_DEVICE_ID[role];
    device.name = SIMULATED_DEVICE_NAME[role];
    device.gatt = gatt;
    return device as unknown as BluetoothDevice;
  }

  return {
    device(role) {
      let device = devices.get(role);
      if (!device) {
        device = createDevice(role);
        devices.set(role, device);
      }
      return device;
    },
    startMovement() {
      const now = clock.now();
      if (movementStartedAt !== null && now - movementStartedAt < SCRIPT_DURATION_MS) return;
      movementStartedAt = now;
    },
  };
}

// — the browser's simulation ————————————————————————————————————————————————————————

let browserSimulation: SensorSimulation | null = null;

function shared(): SensorSimulation {
  browserSimulation ??= createSensorSimulation({
    now: () => performance.now(),
    setInterval: (callback, ms) => window.setInterval(callback, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  });
  return browserSimulation;
}

export function simulatedDevice(role: SensorRole): BluetoothDevice {
  return shared().device(role);
}

export function startMovement(): void {
  shared().startMovement();
}
