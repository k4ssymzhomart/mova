/// <reference types="web-bluetooth" />
"use client";

// liveSensors — the three real sensor connections for the exercise flow, held in one module-level store so they
// survive client-side navigation between flow steps (sensors step -> exercise). A full reload still drops every
// GATT connection: Web Bluetooth needs a fresh click and chooser per page load.
//
// Binding is explicit and per role: connectRole(role) opens Chrome's chooser for that role only. A device already
// bound to another role, in this session or in patient_ble_devices, is refused with a typed error rather than
// silently moved. Web Bluetooth exposes no MAC, so a binding is the browser's device id plus the advertised name.
// The binding is saved (upsert on patient_id + lateralized role) only when the side is known to be left or right;
// otherwise it stays in this session and the role state says so.
//
// Right after a role connects, its sample rate is set to 50 Hz and read back (sampleRate.ts); the result is kept
// per role. The rate a sensor actually delivers is measured independently from received frames, over a rolling
// window, and is the figure to trust.
//
// Link states: "streaming" needs a frame within the last second; "lost" means the link dropped or went silent for
// more than two seconds after streaming. In between, the previous state holds, so one late frame does not flap it.
//
// Frames are dispatched synchronously to subscribeFrames listeners. The snapshot for React (useSyncExternalStore)
// is republished on state changes and on a 250 ms tick while connected, never per frame.

import { useSyncExternalStore } from "react";

import { createClient } from "@/lib/supabase/client";
import type { SensorLink } from "@/lib/sensors/types";

import {
  connectWt901Device,
  requestWt901Device,
  type SensorConnection,
  type SensorConnectionHandlers,
} from "./connectSensor";
import { SENSOR_ROLE_ORDER, bodySiteForRole, type SensorRole, type Side } from "./roles";
import { TARGET_SAMPLE_RATE_HZ, type SampleRateResult } from "./sampleRate";
import type { ParsedWt901Frame } from "./wt901ble68";

export const STREAMING_FRESH_MS = 1000;
export const LOST_SILENCE_MS = 2000;
export const DELIVERED_RATE_WINDOW_MS = 2000;
export const STATUS_TICK_MS = 250;

// — pure helpers ————————————————————————————————————————————————————————————

/** Frames per second actually received, over a rolling window of arrival times. */
export class RateMeter {
  private times: number[] = [];
  private head = 0;
  private firstAt: number | null = null;

  constructor(private readonly windowMs: number = DELIVERED_RATE_WINDOW_MS) {}

  push(atMs: number): void {
    if (this.firstAt === null) this.firstAt = atMs;
    this.times.push(atMs);
    this.prune(atMs);
  }

  /** Frames in the last window divided by the window. Null (unknown) until one full window has been observed. */
  hz(nowMs: number): number | null {
    if (this.firstAt === null || nowMs - this.firstAt < this.windowMs) return null;
    this.prune(nowMs);
    return (this.times.length - this.head) / (this.windowMs / 1000);
  }

  reset(): void {
    this.times = [];
    this.head = 0;
    this.firstAt = null;
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    while (this.head < this.times.length && this.times[this.head] <= cutoff) this.head += 1;
    if (this.head > 1024) {
      this.times = this.times.slice(this.head);
      this.head = 0;
    }
  }
}

export type ConnectionPhase = "idle" | "requesting" | "connecting" | "connected" | "dropped";

export interface LinkInput {
  supported: boolean;
  phase: ConnectionPhase;
  lastFrameAt: number | null;
  previous: SensorLink;
  now: number;
}

export function deriveLink({ supported, phase, lastFrameAt, previous, now }: LinkInput): SensorLink {
  if (!supported) return "unsupported";
  if (phase === "idle") return "disconnected";
  if (phase === "requesting" || phase === "connecting") return "connecting";
  if (phase === "dropped") return lastFrameAt === null ? "disconnected" : "lost";
  if (lastFrameAt === null) return "connecting"; // connected, first frame not here yet
  const silence = now - lastFrameAt;
  if (silence <= STREAMING_FRESH_MS) return "streaming";
  if (silence > LOST_SILENCE_MS) return "lost";
  return previous === "lost" ? "lost" : previous === "streaming" ? "streaming" : "connecting";
}

export interface SavedSensorBinding {
  role: SensorRole;
  side: Side;
  deviceId: string;
  deviceName: string | null;
}

export type BindingConflict =
  | { kind: "session"; otherRole: SensorRole }
  | { kind: "saved"; otherRole: SensorRole; side: Side };

/** A device may serve one role only: refuse it when another role holds it now, or has it saved. */
export function findBindingConflict(
  role: SensorRole,
  deviceId: string,
  sessionDeviceIds: Partial<Record<SensorRole, string | null>>,
  saved: readonly SavedSensorBinding[],
): BindingConflict | null {
  for (const other of SENSOR_ROLE_ORDER) {
    if (other !== role && sessionDeviceIds[other] === deviceId) return { kind: "session", otherRole: other };
  }
  const savedElsewhere = saved.find((binding) => binding.deviceId === deviceId && binding.role !== role);
  return savedElsewhere ? { kind: "saved", otherRole: savedElsewhere.role, side: savedElsewhere.side } : null;
}

/** `patient_ble_devices` rows -> bindings. Rows outside the six lateralized sensor sites are skipped. */
export function bindingsFromDeviceRows(
  rows: readonly { role: string; device_id: string; device_name: string | null }[],
): SavedSensorBinding[] {
  const bindings: SavedSensorBinding[] = [];
  for (const row of rows) {
    const match = /^([lr])_(thigh|shank|foot)$/.exec(row.role);
    if (!match) continue;
    bindings.push({
      role: match[2] as SensorRole,
      side: match[1] === "l" ? "left" : "right",
      deviceId: row.device_id,
      deviceName: row.device_name,
    });
  }
  return bindings;
}

// — state ———————————————————————————————————————————————————————————————————

/**
 * - unsupported: no Web Bluetooth in this browser.
 * - busy: this role is already opening the chooser or connecting.
 * - chooser_cancelled: the patient closed the chooser. Not recorded as lastError.
 * - request_failed: the chooser could not open (Bluetooth off, no user gesture, insecure origin; see detail).
 * - device_bound_to_other_role / device_saved_for_other_role: refused; `otherRole` names the holder.
 * - connect_failed: GATT connection or service discovery failed.
 * - connection_dropped: the link dropped after connecting.
 * - cancelled: disconnectRole/disconnectAll ran while this connect was in progress.
 */
export type LiveSensorErrorCode =
  | "unsupported"
  | "busy"
  | "chooser_cancelled"
  | "request_failed"
  | "device_bound_to_other_role"
  | "device_saved_for_other_role"
  | "connect_failed"
  | "connection_dropped"
  | "cancelled";

export interface LiveSensorErrorInfo {
  code: LiveSensorErrorCode;
  otherRole: SensorRole | null;
  deviceName: string | null;
  /** Technical detail from the browser, for logs and support. Not patient-facing text. */
  detail: string | null;
  at: number;
}

export class LiveSensorError extends Error {
  constructor(
    readonly role: SensorRole,
    readonly info: LiveSensorErrorInfo,
  ) {
    super(`${role}: ${info.code}${info.detail ? ` (${info.detail})` : ""}`);
    this.name = "LiveSensorError";
  }

  get code(): LiveSensorErrorCode {
    return this.info.code;
  }
}

export type RateState =
  | { status: "idle" }
  | { status: "configuring"; requestedHz: number }
  | { status: "done"; result: SampleRateResult };

export type BindingPersistence =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "session_only"; reason: "side_unknown" | "no_patient" }
  | { status: "failed"; detail: string };

export interface LiveRoleState {
  role: SensorRole;
  link: SensorLink;
  deviceId: string | null;
  deviceName: string | null;
  rate: RateState;
  /** Measured from received frames; null while unknown (not connected, or less than one window observed). */
  deliveredHz: number | null;
  framesReceived: number;
  /** Epoch ms of the last frame, as of the latest snapshot. */
  lastSampleAt: number | null;
  persistence: BindingPersistence;
  lastError: LiveSensorErrorInfo | null;
}

export interface LiveSensorsSnapshot {
  /** Whether this browser has Web Bluetooth; null on the server, before the browser has been checked. */
  supported: boolean | null;
  roles: Record<SensorRole, LiveRoleState>;
  allStreaming: boolean;
  /** Some role is connecting, streaming or lost: the live transport has something to report. */
  active: boolean;
}

export interface ConnectRoleOptions {
  patientId: string | null;
  /** The leg the sensors are on. Only left/right lets the binding be saved. */
  side: Side | null;
  /** This patient's saved bindings, e.g. `bindingsFromDeviceRows(patient_ble_devices rows)`. */
  savedBindings?: readonly SavedSensorBinding[];
}

export type LiveFrameListener = (role: SensorRole, frame: ParsedWt901Frame, receivedAtMs: number) => void;

export interface BindingRow {
  patient_id: string;
  role: string;
  device_id: string;
  device_name: string | null;
  last_connected_at: string;
}

/** Everything the store touches outside itself, injectable for tests. */
export interface LiveSensorsDeps {
  isSupported(): boolean;
  requestDevice(): Promise<BluetoothDevice>;
  connectDevice(device: BluetoothDevice, handlers: SensorConnectionHandlers): Promise<SensorConnection>;
  /** Upsert one binding; resolves with an error message, or null on success. */
  persistBinding(row: BindingRow): Promise<string | null>;
  now(): number;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface LiveSensorsStore {
  /** Call from a click handler. Resolves once GATT is connected; rejects with LiveSensorError. */
  connectRole(role: SensorRole, options: ConnectRoleOptions): Promise<LiveRoleState>;
  disconnectRole(role: SensorRole): void;
  disconnectAll(): void;
  /** Run the rate write + readback again for a connected role; null when it is not connected. */
  reconfigureRate(role: SensorRole): Promise<SampleRateResult | null>;
  subscribeFrames(listener: LiveFrameListener): () => void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): LiveSensorsSnapshot;
}

const IDLE_RATE: RateState = { status: "idle" };
const IDLE_PERSISTENCE: BindingPersistence = { status: "idle" };

function idleRoleState(role: SensorRole, link: SensorLink): LiveRoleState {
  return {
    role,
    link,
    deviceId: null,
    deviceName: null,
    rate: IDLE_RATE,
    deliveredHz: null,
    framesReceived: 0,
    lastSampleAt: null,
    persistence: IDLE_PERSISTENCE,
    lastError: null,
  };
}

function sameRoleState(a: LiveRoleState, b: LiveRoleState): boolean {
  return (
    a.link === b.link &&
    a.deviceId === b.deviceId &&
    a.deviceName === b.deviceName &&
    a.rate === b.rate &&
    a.deliveredHz === b.deliveredHz &&
    a.framesReceived === b.framesReceived &&
    a.lastSampleAt === b.lastSampleAt &&
    a.persistence === b.persistence &&
    a.lastError === b.lastError
  );
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isChooserCancel(error: unknown): boolean {
  const { name, message } = (error ?? {}) as { name?: unknown; message?: unknown };
  return name === "NotFoundError" && typeof message === "string" && /cancel/i.test(message);
}

export function createLiveSensorsStore(deps: LiveSensorsDeps): LiveSensorsStore {
  interface Entry {
    role: SensorRole;
    phase: ConnectionPhase;
    requesting: boolean;
    generation: number;
    connection: SensorConnection | null;
    deviceId: string | null;
    deviceName: string | null;
    rate: RateState;
    meter: RateMeter;
    framesReceived: number;
    lastFrameAt: number | null;
    persistence: BindingPersistence;
    lastError: LiveSensorErrorInfo | null;
    link: SensorLink;
  }

  const entries = {} as Record<SensorRole, Entry>;
  for (const role of SENSOR_ROLE_ORDER) {
    entries[role] = {
      role,
      phase: "idle",
      requesting: false,
      generation: 0,
      connection: null,
      deviceId: null,
      deviceName: null,
      rate: IDLE_RATE,
      meter: new RateMeter(),
      framesReceived: 0,
      lastFrameAt: null,
      persistence: IDLE_PERSISTENCE,
      lastError: null,
      link: "disconnected",
    };
  }

  const listeners = new Set<() => void>();
  const frameListeners = new Set<LiveFrameListener>();
  // Bindings written during this page's lifetime, keyed `${patientId}:${bodySite}`, layered over the rows the
  // caller loaded at page render so a rebind in this session is seen by the next conflict check.
  const savedThisSession = new Map<string, SavedSensorBinding>();
  let supported: boolean | null = null;
  let snapshot: LiveSensorsSnapshot | null = null;
  let ticker: unknown = null;

  const isSupported = () => (supported ??= deps.isSupported());

  const makeError = (
    code: LiveSensorErrorCode,
    extra: Partial<Pick<LiveSensorErrorInfo, "otherRole" | "deviceName" | "detail">> = {},
  ): LiveSensorErrorInfo => ({
    code,
    otherRole: extra.otherRole ?? null,
    deviceName: extra.deviceName ?? null,
    detail: extra.detail ?? null,
    at: deps.now(),
  });

  function buildSnapshot(): LiveSensorsSnapshot {
    const now = deps.now();
    const isBleSupported = isSupported();
    const roles = {} as Record<SensorRole, LiveRoleState>;
    for (const role of SENSOR_ROLE_ORDER) {
      const entry = entries[role];
      entry.link = deriveLink({
        supported: isBleSupported,
        phase: entry.requesting ? "requesting" : entry.phase,
        lastFrameAt: entry.lastFrameAt,
        previous: entry.link,
        now,
      });
      const next: LiveRoleState = {
        role,
        link: entry.link,
        deviceId: entry.deviceId,
        deviceName: entry.deviceName,
        rate: entry.rate,
        deliveredHz: entry.phase === "connected" ? entry.meter.hz(now) : null,
        framesReceived: entry.framesReceived,
        lastSampleAt: entry.lastFrameAt,
        persistence: entry.persistence,
        lastError: entry.lastError,
      };
      const previous = snapshot?.roles[role];
      roles[role] = previous && sameRoleState(previous, next) ? previous : next;
    }
    return {
      supported: isBleSupported,
      roles,
      allStreaming: SENSOR_ROLE_ORDER.every((role) => roles[role].link === "streaming"),
      active: SENSOR_ROLE_ORDER.some((role) => ["connecting", "streaming", "lost"].includes(roles[role].link)),
    };
  }

  function publish(): void {
    const next = buildSnapshot();
    if (
      snapshot &&
      snapshot.supported === next.supported &&
      SENSOR_ROLE_ORDER.every((role) => snapshot?.roles[role] === next.roles[role])
    ) {
      return;
    }
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  function ensureTicker(): void {
    if (ticker === null) ticker = deps.setInterval(publish, STATUS_TICK_MS);
  }

  function stopTickerIfIdle(): void {
    if (ticker === null || SENSOR_ROLE_ORDER.some((role) => entries[role].phase === "connected")) return;
    deps.clearInterval(ticker);
    ticker = null;
  }

  /** Detach the current connection; its late callbacks are ignored because the generation moved on. */
  function release(entry: Entry): void {
    entry.generation += 1;
    const connection = entry.connection;
    entry.connection = null;
    connection?.disconnect();
  }

  function resetEntry(entry: Entry): void {
    entry.phase = "idle";
    entry.requesting = false;
    entry.deviceId = null;
    entry.deviceName = null;
    entry.rate = IDLE_RATE;
    entry.meter.reset();
    entry.framesReceived = 0;
    entry.lastFrameAt = null;
    entry.persistence = IDLE_PERSISTENCE;
    entry.lastError = null;
  }

  function receiveFrame(entry: Entry, frame: ParsedWt901Frame): void {
    const now = deps.now();
    entry.framesReceived += 1;
    entry.lastFrameAt = now;
    entry.meter.push(now);
    if (entry.phase === "connected" && !entry.requesting && entry.link !== "streaming") publish();
    for (const listener of frameListeners) {
      try {
        listener(entry.role, frame, now);
      } catch {
        /* one failing consumer must not starve the others */
      }
    }
  }

  function dropped(entry: Entry): void {
    entry.connection = null;
    entry.phase = "dropped";
    entry.lastError = makeError("connection_dropped", { deviceName: entry.deviceName });
    stopTickerIfIdle();
    publish();
  }

  function effectiveSaved(options: ConnectRoleOptions): SavedSensorBinding[] {
    const bySite = new Map<string, SavedSensorBinding>();
    for (const binding of options.savedBindings ?? []) bySite.set(bodySiteForRole(binding.role, binding.side), binding);
    if (options.patientId) {
      const prefix = `${options.patientId}:`;
      for (const [key, binding] of savedThisSession) {
        if (key.startsWith(prefix)) bySite.set(key.slice(prefix.length), binding);
      }
    }
    return [...bySite.values()];
  }

  async function persistBinding(entry: Entry, generation: number, options: ConnectRoleOptions): Promise<void> {
    const { patientId, side } = options;
    if (!patientId || (side !== "left" && side !== "right")) {
      entry.persistence = { status: "session_only", reason: patientId ? "side_unknown" : "no_patient" };
      publish();
      return;
    }
    const deviceId = entry.deviceId;
    if (!deviceId) return;
    const deviceName = entry.deviceName;
    const bodySite = bodySiteForRole(entry.role, side);
    entry.persistence = { status: "saving" };
    publish();
    let failure: string | null;
    try {
      failure = await deps.persistBinding({
        patient_id: patientId,
        role: bodySite,
        device_id: deviceId,
        device_name: deviceName,
        last_connected_at: new Date(deps.now()).toISOString(),
      });
    } catch (error) {
      failure = errorDetail(error);
    }
    if (!failure) savedThisSession.set(`${patientId}:${bodySite}`, { role: entry.role, side, deviceId, deviceName });
    if (entry.generation !== generation) return;
    entry.persistence = failure ? { status: "failed", detail: failure } : { status: "saved" };
    publish();
  }

  async function configureRate(entry: Entry, generation: number): Promise<SampleRateResult | null> {
    const connection = entry.connection;
    if (!connection || entry.generation !== generation) return null;
    entry.rate = { status: "configuring", requestedHz: TARGET_SAMPLE_RATE_HZ };
    publish();
    const result = await connection.configureSampleRate(TARGET_SAMPLE_RATE_HZ);
    if (entry.generation !== generation) return null;
    entry.rate = { status: "done", result };
    publish();
    return result;
  }

  async function connectRole(role: SensorRole, options: ConnectRoleOptions): Promise<LiveRoleState> {
    const entry = entries[role];
    if (!isSupported()) throw new LiveSensorError(role, makeError("unsupported"));
    if (entry.requesting || entry.phase === "connecting") throw new LiveSensorError(role, makeError("busy"));

    // The chooser opens first, while the click's user activation is still fresh. Any current connection for
    // this role keeps running until a device is actually picked.
    const requestGeneration = entry.generation;
    entry.requesting = true;
    publish();
    let device: BluetoothDevice;
    try {
      device = await deps.requestDevice();
    } catch (error) {
      if (entry.generation !== requestGeneration) throw new LiveSensorError(role, makeError("cancelled"));
      entry.requesting = false;
      if (isChooserCancel(error)) {
        publish();
        throw new LiveSensorError(role, makeError("chooser_cancelled"));
      }
      entry.lastError = makeError("request_failed", { detail: errorDetail(error) });
      publish();
      throw new LiveSensorError(role, entry.lastError);
    }
    if (entry.generation !== requestGeneration) throw new LiveSensorError(role, makeError("cancelled"));
    entry.requesting = false;

    const deviceName = device.name ?? null;
    const sessionDeviceIds: Partial<Record<SensorRole, string | null>> = {};
    for (const other of SENSOR_ROLE_ORDER) sessionDeviceIds[other] = entries[other].deviceId;
    const conflict = findBindingConflict(role, device.id, sessionDeviceIds, effectiveSaved(options));
    if (conflict) {
      entry.lastError = makeError(
        conflict.kind === "session" ? "device_bound_to_other_role" : "device_saved_for_other_role",
        { otherRole: conflict.otherRole, deviceName },
      );
      publish();
      throw new LiveSensorError(role, entry.lastError);
    }

    release(entry);
    resetEntry(entry);
    const generation = entry.generation;
    entry.phase = "connecting";
    entry.deviceId = device.id;
    entry.deviceName = deviceName;
    publish();

    let droppedWhileConnecting = false;
    let connection: SensorConnection;
    try {
      connection = await deps.connectDevice(device, {
        onFrame: (frame) => {
          if (entry.generation === generation) receiveFrame(entry, frame);
        },
        onStatusChange: (status) => {
          if (status !== "disconnected" || entry.generation !== generation) return;
          if (entry.connection) dropped(entry);
          else droppedWhileConnecting = true;
        },
      });
    } catch (error) {
      if (entry.generation !== generation) throw new LiveSensorError(role, makeError("cancelled"));
      resetEntry(entry);
      entry.lastError = makeError("connect_failed", { deviceName, detail: errorDetail(error) });
      publish();
      throw new LiveSensorError(role, entry.lastError);
    }
    if (entry.generation !== generation) {
      connection.disconnect();
      throw new LiveSensorError(role, makeError("cancelled"));
    }
    if (droppedWhileConnecting) {
      connection.disconnect();
      resetEntry(entry);
      entry.lastError = makeError("connect_failed", { deviceName, detail: "Link dropped while connecting" });
      publish();
      throw new LiveSensorError(role, entry.lastError);
    }

    entry.connection = connection;
    entry.phase = "connected";
    ensureTicker();
    publish();
    void persistBinding(entry, generation, options);
    void configureRate(entry, generation);
    return getSnapshot().roles[role];
  }

  function disconnectRole(role: SensorRole): void {
    const entry = entries[role];
    release(entry);
    resetEntry(entry);
    stopTickerIfIdle();
    publish();
  }

  function getSnapshot(): LiveSensorsSnapshot {
    if (!snapshot) snapshot = buildSnapshot();
    return snapshot;
  }

  return {
    connectRole,
    disconnectRole,
    disconnectAll: () => {
      for (const role of SENSOR_ROLE_ORDER) {
        release(entries[role]);
        resetEntry(entries[role]);
      }
      stopTickerIfIdle();
      publish();
    },
    reconfigureRate: (role) => configureRate(entries[role], entries[role].generation),
    subscribeFrames: (listener) => {
      frameListeners.add(listener);
      return () => {
        frameListeners.delete(listener);
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot,
  };
}

// — the browser singleton ———————————————————————————————————————————————————————

let supabase: ReturnType<typeof createClient> | null = null;

const store = createLiveSensorsStore({
  isSupported: () => typeof navigator !== "undefined" && Boolean(navigator.bluetooth),
  requestDevice: requestWt901Device,
  connectDevice: connectWt901Device,
  persistBinding: async (row) => {
    supabase ??= createClient();
    const { error } = await supabase.from("patient_ble_devices").upsert(row, { onConflict: "patient_id,role" });
    return error ? error.message : null;
  },
  now: () => Date.now(),
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
});

const SERVER_SNAPSHOT: LiveSensorsSnapshot = {
  supported: null,
  roles: {
    thigh: idleRoleState("thigh", "disconnected"),
    shank: idleRoleState("shank", "disconnected"),
    foot: idleRoleState("foot", "disconnected"),
  },
  allStreaming: false,
  active: false,
};

export const connectRole = store.connectRole;
export const disconnectRole = store.disconnectRole;
export const disconnectAll = store.disconnectAll;
export const reconfigureRate = store.reconfigureRate;
export const subscribeFrames = store.subscribeFrames;
export const subscribe = store.subscribe;
export const getSnapshot = store.getSnapshot;

export function getServerSnapshot(): LiveSensorsSnapshot {
  return SERVER_SNAPSHOT;
}

/** Per-role link, device, rate readback, delivered Hz, frame count, persistence and last error. */
export function useLiveSensors(): LiveSensorsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
