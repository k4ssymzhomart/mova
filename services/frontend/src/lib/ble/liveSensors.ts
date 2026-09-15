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
// Right after a role connects, and again after every reconnect, its sample rate is set to the store's requested
// rate (50 Hz unless setRequestedRate(100)) and read back (sampleRate.ts); every result is kept per role, in order.
// Then the battery voltage is read (register 0x64), and again every minute while streaming. The rate a sensor
// actually delivers is measured independently from received frames and is the figure to trust.
//
// A link that drops without disconnectRole/disconnectAll asking for it is reconnected on the same BluetoothDevice,
// with no chooser, after 1, 2, 4, 8 and then every 10 s, for up to two minutes. After that the role is lost, and a
// press on its button tries the same device once more before it opens the chooser. A press while an automatic
// attempt is still running takes that attempt over instead of waiting for it (an automatic attempt may take up to
// the 15 s connect timeout): the old attempt's result is ignored, and the press runs its own same-device try, or
// opens the chooser when an earlier press was already told the next one would. The role's `press` says which, so
// the row can show it. Nothing about the session lives here, so frames simply resume when the link is back.
//
// Link states: "streaming" needs a frame within the last second; "lost" means the link dropped for good or went
// silent for more than two seconds after streaming; "connecting" covers pairing and reconnecting. In between, the
// previous state holds, so one late frame does not flap it.
//
// Frames are dispatched synchronously to subscribeFrames listeners. The snapshot for React (useSyncExternalStore)
// is republished on state changes and on a 250 ms tick while connected or reconnecting, never per frame.

import { useSyncExternalStore } from "react";

import { createClient } from "@/lib/supabase/client";
import type { SensorLink } from "@/lib/sensors/types";

import {
  connectWt901Device,
  requestWt901Device,
  type ConnectDeviceOptions,
  type SensorConnection,
  type SensorConnectionHandlers,
} from "./connectSensor";
import { SENSOR_ROLE_ORDER, bodySiteForRole, type SensorRole, type Side } from "./roles";
import { TARGET_SAMPLE_RATE_HZ, type SampleRateResult } from "./sampleRate";
import type { SupportedRateHz } from "./witRegister";
import type { ParsedWt901Frame } from "./wt901ble68";

export const STREAMING_FRESH_MS = 1000;
export const LOST_SILENCE_MS = 2000;
export const DELIVERED_RATE_WINDOW_MS = 2000;
export const STATUS_TICK_MS = 250;
/** Rolling frame counts for the hardware protocol: 30 s for one sensor, 60 s for all three. */
export const FRAME_COUNT_WINDOWS_MS = { last30s: 30_000, last60s: 60_000 } as const;
/** Receive times kept per role: 60 s at 200 Hz, twice the fastest rate ever requested. */
export const FRAME_RING_CAPACITY = 60 * 200;
export const BATTERY_READ_INTERVAL_MS = 60_000;
export const RECONNECT_GIVE_UP_MS = 120_000;
/**
 * A press on a dropped role tries the same device for this long before it falls back to the chooser, which only
 * opens while the click still counts as a user gesture (about five seconds in Chrome).
 */
export const MANUAL_SAME_DEVICE_TIMEOUT_MS = 4_000;
export const RATE_HISTORY_LIMIT = 32;
export const DEVICE_ID_SHORT_LENGTH = 6;

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

/**
 * Receive times of the most recent frames in a fixed ring, for rolling frame counts. Times arrive in order, so a
 * window count is a binary search. A window longer than the ring holds at the arrival rate is capped at capacity.
 */
export class FrameTimeRing {
  private readonly times: Float64Array;
  private start = 0;
  private size = 0;
  private firstAt: number | null = null;

  constructor(readonly capacity: number = FRAME_RING_CAPACITY) {
    this.times = new Float64Array(capacity);
  }

  push(atMs: number): void {
    if (this.firstAt === null) this.firstAt = atMs;
    if (this.size < this.capacity) {
      this.times[(this.start + this.size) % this.capacity] = atMs;
      this.size += 1;
    } else {
      this.times[this.start] = atMs;
      this.start = (this.start + 1) % this.capacity;
    }
  }

  /** Frames received in the last `windowMs`. Null until that long has passed since the first frame. */
  count(nowMs: number, windowMs: number): number | null {
    if (this.firstAt === null || nowMs - this.firstAt < windowMs) return null;
    const cutoff = nowMs - windowMs;
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.times[(this.start + mid) % this.capacity] > cutoff) hi = mid;
      else lo = mid + 1;
    }
    return this.size - lo;
  }

  reset(): void {
    this.start = 0;
    this.size = 0;
    this.firstAt = null;
  }
}

/** Delay before the reconnect attempt at `attemptIndex` (0-based) in one outage: 1, 2, 4, 8, then 10 s each. */
export function reconnectDelayMs(attemptIndex: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attemptIndex), 10_000);
}

export type ReconnectStep = { kind: "wait"; atMs: number } | { kind: "give_up" };

/**
 * What to do after `attemptsMade` failed attempts since the link dropped at `droppedAtMs`. No attempt is planned
 * past RECONNECT_GIVE_UP_MS: the last one is pulled in to that deadline, and a failure at or after it gives up.
 */
export function nextReconnectStep(droppedAtMs: number, attemptsMade: number, nowMs: number): ReconnectStep {
  const deadline = droppedAtMs + RECONNECT_GIVE_UP_MS;
  if (nowMs >= deadline) return { kind: "give_up" };
  return { kind: "wait", atMs: Math.min(nowMs + reconnectDelayMs(attemptsMade), deadline) };
}

/** The last characters of the browser's device id, enough for a tester to recognise a sensor again. */
export function shortDeviceId(deviceId: string | null): string | null {
  return deviceId === null ? null : deviceId.slice(-DEVICE_ID_SHORT_LENGTH);
}

export type ConnectionPhase = "idle" | "requesting" | "connecting" | "connected" | "reconnecting" | "dropped";

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
  if (phase === "requesting" || phase === "connecting" || phase === "reconnecting") return "connecting";
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

export interface BindingPlan {
  conflict: BindingConflict | null;
  /** Rows that hold this device for the same role on the other leg; removed when the new binding is saved. */
  replaces: SavedSensorBinding[];
}

/**
 * A device may serve one role only. It is refused when another role holds it now, or has it saved on either leg.
 * The same role saved on the other leg is not a conflict (the same sensor on the other knee), but that row still
 * holds the device, and patient_ble_devices allows one row per (patient_id, device_id), so it is returned in
 * `replaces` to be removed when this binding is saved. With the side unknown nothing is saved, so nothing is
 * replaced.
 */
export function planBinding(
  role: SensorRole,
  side: Side | null,
  deviceId: string,
  sessionDeviceIds: Partial<Record<SensorRole, string | null>>,
  saved: readonly SavedSensorBinding[],
): BindingPlan {
  for (const other of SENSOR_ROLE_ORDER) {
    if (other !== role && sessionDeviceIds[other] === deviceId) {
      return { conflict: { kind: "session", otherRole: other }, replaces: [] };
    }
  }
  const holding = saved.filter((binding) => binding.deviceId === deviceId);
  const elsewhere = holding.find((binding) => binding.role !== role);
  if (elsewhere) {
    return { conflict: { kind: "saved", otherRole: elsewhere.role, side: elsewhere.side }, replaces: [] };
  }
  return { conflict: null, replaces: side === null ? [] : holding.filter((binding) => binding.side !== side) };
}

/** The conflict part of {@link planBinding}. */
export function findBindingConflict(
  role: SensorRole,
  deviceId: string,
  sessionDeviceIds: Partial<Record<SensorRole, string | null>>,
  saved: readonly SavedSensorBinding[],
  side: Side | null = null,
): BindingConflict | null {
  return planBinding(role, side, deviceId, sessionDeviceIds, saved).conflict;
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
 * - busy: a press on this role is still running, or the role is opening the chooser or connecting a picked device.
 *   An automatic reconnect attempt in flight is not busy: a press takes it over.
 * - chooser_cancelled: the patient closed the chooser. Not recorded as lastError.
 * - request_failed: the chooser could not open (Bluetooth off, no user gesture, insecure origin; see detail).
 * - device_bound_to_other_role / device_saved_for_other_role: refused; `otherRole` names the holder.
 * - connect_failed: GATT connection or service discovery failed or timed out, or a dropped sensor did not come
 *   back when pressed and the chooser could no longer open in the same press (the next press opens it).
 * - connection_dropped: the link dropped after connecting (also while it is being reconnected).
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

/** One finished rate write + readback, stamped with the store's clock. */
export type RateHistoryEntry = SampleRateResult & { atMs: number };

/** A successful 0x64 read. `vendorPercent` is WitMotion's interpolation table, not a measured state of charge. */
export interface BatteryReading {
  volts: number;
  vendorPercent: number;
  atMs: number;
}

export interface ReconnectState {
  state: "idle" | "reconnecting" | "gave_up";
  /** Same-device reconnect attempts, automatic or pressed, since this device was bound to the role. */
  attempts: number;
  /** When the next automatic attempt is due; null while one is running or none is planned. */
  nextAttemptAtMs: number | null;
  /** Attempts that brought the link back, since this device was bound to the role. */
  succeeded: number;
}

/**
 * What a press on a role's button is doing: trying the bound sensor again without the chooser ("same_device"), or
 * the chooser and connecting the sensor picked in it ("choosing"). Null when no press is running.
 */
export type PressStage = "same_device" | "choosing" | null;

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
  /** Last six characters of deviceId. */
  deviceIdShort: string | null;
  deviceName: string | null;
  /** The rate this store writes on every connect and reconnect (setRequestedRate). */
  requestedHz: SupportedRateHz;
  /** The latest rate write + readback (or the one in progress). */
  rate: RateState;
  /** Every finished rate write + readback for this device, oldest first, reconnects included (last 32 kept). */
  rateHistory: RateHistoryEntry[];
  /** Measured from received frames; null while unknown (not connected, or less than one window since connecting). */
  deliveredHz: number | null;
  /** Same as framesTotal; kept for existing readers. */
  framesReceived: number;
  /** Frames received since this device was bound to the role, across reconnects. */
  framesTotal: number;
  /** Frames received in the last 30 s; null until 30 s have passed since the first frame. */
  framesLast30s: number | null;
  /** Frames received in the last 60 s; null until 60 s have passed since the first frame. */
  framesLast60s: number | null;
  /** Time with the GATT link up since this device was bound to the role, reconnect gaps excluded. */
  connectedForMs: number;
  /** Epoch ms of the last frame, as of the latest snapshot. */
  lastSampleAt: number | null;
  /** The latest successful battery read; its atMs dates it. Null until one succeeds. */
  battery: BatteryReading | null;
  /** Why the most recent battery read failed ("no_reply", "write_failed", "implausible_value"); null after a success. */
  batteryError: string | null;
  reconnect: ReconnectState;
  /** The press running on this role, if any (connectRole). */
  press: PressStage;
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
  connectDevice(
    device: BluetoothDevice,
    handlers: SensorConnectionHandlers,
    options?: ConnectDeviceOptions,
  ): Promise<SensorConnection>;
  /**
   * Remove this patient's rows for `replacedRoles` that hold `row.device_id`, then upsert `row`. Resolves with an
   * error message, or null on success.
   */
  persistBinding(row: BindingRow, replacedRoles: readonly string[]): Promise<string | null>;
  /** Whether the current click still counts as a user gesture, so the chooser may open. */
  hasUserActivation(): boolean;
  now(): number;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface LiveSensorsStore {
  /**
   * Call from a click handler. Resolves once GATT is connected; rejects with LiveSensorError. A role whose link
   * dropped is tried as the same device first, without the chooser.
   */
  connectRole(role: SensorRole, options: ConnectRoleOptions): Promise<LiveRoleState>;
  disconnectRole(role: SensorRole): void;
  disconnectAll(): void;
  /** Run the rate write + readback again for a connected role; null when it is not connected. */
  reconfigureRate(role: SensorRole): Promise<SampleRateResult | null>;
  /** 50 or 100 Hz (anything else means 50). Applied to connected roles now and on every later connect. */
  setRequestedRate(hz: SupportedRateHz): void;
  getRequestedRate(): SupportedRateHz;
  subscribeFrames(listener: LiveFrameListener): () => void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): LiveSensorsSnapshot;
}

const IDLE_RATE: RateState = { status: "idle" };
const IDLE_PERSISTENCE: BindingPersistence = { status: "idle" };
const IDLE_RECONNECT: ReconnectState = { state: "idle", attempts: 0, nextAttemptAtMs: null, succeeded: 0 };
const NO_RATE_HISTORY: RateHistoryEntry[] = [];

function idleRoleState(role: SensorRole, link: SensorLink): LiveRoleState {
  return {
    role,
    link,
    deviceId: null,
    deviceIdShort: null,
    deviceName: null,
    requestedHz: TARGET_SAMPLE_RATE_HZ,
    rate: IDLE_RATE,
    rateHistory: NO_RATE_HISTORY,
    deliveredHz: null,
    framesReceived: 0,
    framesTotal: 0,
    framesLast30s: null,
    framesLast60s: null,
    connectedForMs: 0,
    lastSampleAt: null,
    battery: null,
    batteryError: null,
    reconnect: IDLE_RECONNECT,
    press: null,
    persistence: IDLE_PERSISTENCE,
    lastError: null,
  };
}

function sameRoleState(a: LiveRoleState, b: LiveRoleState): boolean {
  return (Object.keys(a) as (keyof LiveRoleState)[]).every((key) => a[key] === b[key]);
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
    /** Moves on release (a disconnect or a new device for the role): everything started before is ignored. */
    generation: number;
    /** Moves on every GATT connect attempt and on a drop: callbacks and results from an older link are ignored. */
    linkToken: number;
    connection: SensorConnection | null;
    device: BluetoothDevice | null;
    deviceId: string | null;
    deviceName: string | null;
    rate: RateState;
    rateRuns: number;
    rateHistory: RateHistoryEntry[];
    meter: RateMeter;
    ring: FrameTimeRing;
    framesReceived: number;
    lastFrameAt: number | null;
    connectedMsBefore: number;
    connectedSince: number | null;
    battery: BatteryReading | null;
    batteryError: string | null;
    /** linkToken of the battery read in flight, if any. */
    batteryReadLink: number | null;
    batteryAttemptAt: number | null;
    reconnect: ReconnectState;
    droppedAt: number | null;
    outageAttempts: number;
    attemptInFlight: boolean;
    /** A pressed same-device attempt failed: the next press goes straight to the chooser. */
    skipSameDevice: boolean;
    press: PressStage;
    /** Moves on every press and when a disconnect ends one, so a press that settles late does not clear a newer one. */
    pressSeq: number;
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
      linkToken: 0,
      connection: null,
      device: null,
      deviceId: null,
      deviceName: null,
      rate: IDLE_RATE,
      rateRuns: 0,
      rateHistory: NO_RATE_HISTORY,
      meter: new RateMeter(),
      ring: new FrameTimeRing(),
      framesReceived: 0,
      lastFrameAt: null,
      connectedMsBefore: 0,
      connectedSince: null,
      battery: null,
      batteryError: null,
      batteryReadLink: null,
      batteryAttemptAt: null,
      reconnect: IDLE_RECONNECT,
      droppedAt: null,
      outageAttempts: 0,
      attemptInFlight: false,
      skipSameDevice: false,
      press: null,
      pressSeq: 0,
      persistence: IDLE_PERSISTENCE,
      lastError: null,
      link: "disconnected",
    };
  }

  const listeners = new Set<() => void>();
  const frameListeners = new Set<LiveFrameListener>();
  // Bindings written during this page's lifetime, keyed `${patientId}:${bodySite}`, layered over the rows the
  // caller loaded at page render so a rebind in this session is seen by the next conflict check. A null value is a
  // row this session removed.
  const savedThisSession = new Map<string, SavedSensorBinding | null>();
  let supported: boolean | null = null;
  let snapshot: LiveSensorsSnapshot | null = null;
  let ticker: unknown = null;
  let requestedHz: SupportedRateHz = TARGET_SAMPLE_RATE_HZ;

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
      // On a link that just came back, the last frame from before the drop says nothing about this link.
      const staleFrame =
        entry.phase === "connected" &&
        entry.connectedSince !== null &&
        entry.lastFrameAt !== null &&
        entry.lastFrameAt < entry.connectedSince &&
        entry.reconnect.succeeded > 0;
      entry.link = deriveLink({
        supported: isBleSupported,
        phase: entry.requesting ? "requesting" : entry.phase,
        lastFrameAt: staleFrame ? null : entry.lastFrameAt,
        previous: entry.link,
        now,
      });
      const next: LiveRoleState = {
        role,
        link: entry.link,
        deviceId: entry.deviceId,
        deviceIdShort: shortDeviceId(entry.deviceId),
        deviceName: entry.deviceName,
        requestedHz,
        rate: entry.rate,
        rateHistory: entry.rateHistory,
        deliveredHz: entry.phase === "connected" ? entry.meter.hz(now) : null,
        framesReceived: entry.framesReceived,
        framesTotal: entry.framesReceived,
        framesLast30s: entry.ring.count(now, FRAME_COUNT_WINDOWS_MS.last30s),
        framesLast60s: entry.ring.count(now, FRAME_COUNT_WINDOWS_MS.last60s),
        connectedForMs: entry.connectedMsBefore + (entry.connectedSince === null ? 0 : now - entry.connectedSince),
        lastSampleAt: entry.lastFrameAt,
        battery: entry.battery,
        batteryError: entry.batteryError,
        reconnect: entry.reconnect,
        press: entry.press,
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

  function onTick(): void {
    const now = deps.now();
    for (const role of SENSOR_ROLE_ORDER) {
      const entry = entries[role];
      const due = entry.reconnect.nextAttemptAtMs;
      if (
        entry.phase === "reconnecting" &&
        !entry.attemptInFlight &&
        !entry.requesting &&
        entry.press === null &&
        due !== null &&
        now >= due
      ) {
        void attemptReconnect(entry, false);
      } else if (
        entry.phase === "connected" &&
        entry.link === "streaming" &&
        entry.batteryAttemptAt !== null &&
        entry.batteryReadLink !== entry.linkToken &&
        now - entry.batteryAttemptAt >= BATTERY_READ_INTERVAL_MS
      ) {
        void readBattery(entry);
      }
    }
    publish();
  }

  function ensureTicker(): void {
    if (ticker === null) ticker = deps.setInterval(onTick, STATUS_TICK_MS);
  }

  function stopTickerIfIdle(): void {
    const busy = SENSOR_ROLE_ORDER.some((role) => ["connected", "reconnecting"].includes(entries[role].phase));
    if (ticker === null || busy) return;
    deps.clearInterval(ticker);
    ticker = null;
  }

  function markConnected(entry: Entry): void {
    entry.connectedSince = deps.now();
  }

  function markDisconnected(entry: Entry): void {
    if (entry.connectedSince === null) return;
    entry.connectedMsBefore += deps.now() - entry.connectedSince;
    entry.connectedSince = null;
  }

  /** A disconnect ends any press on the role; that press still settles (as cancelled) but leaves the role alone. */
  function endPress(entry: Entry): void {
    entry.press = null;
    entry.pressSeq += 1;
  }

  /** Detach the current connection; its late callbacks are ignored because the generation moved on. */
  function release(entry: Entry): void {
    markDisconnected(entry);
    entry.generation += 1;
    const connection = entry.connection;
    entry.connection = null;
    connection?.disconnect();
  }

  /** Back to idle. `keepRecord` keeps what was measured on this device (a press re-picked the same sensor). */
  function resetEntry(entry: Entry, keepRecord = false): void {
    entry.phase = "idle";
    entry.requesting = false;
    entry.device = null;
    entry.deviceId = null;
    entry.deviceName = null;
    entry.rate = IDLE_RATE;
    entry.rateRuns = 0;
    entry.meter.reset();
    entry.lastFrameAt = null;
    entry.connectedSince = null;
    entry.batteryReadLink = null;
    entry.batteryAttemptAt = null;
    entry.droppedAt = null;
    entry.outageAttempts = 0;
    entry.attemptInFlight = false;
    entry.skipSameDevice = false;
    entry.persistence = IDLE_PERSISTENCE;
    entry.lastError = null;
    if (keepRecord) {
      entry.reconnect = { ...entry.reconnect, state: "idle", nextAttemptAtMs: null };
      return;
    }
    entry.rateHistory = NO_RATE_HISTORY;
    entry.ring.reset();
    entry.framesReceived = 0;
    entry.connectedMsBefore = 0;
    entry.battery = null;
    entry.batteryError = null;
    entry.reconnect = IDLE_RECONNECT;
  }

  function lastRateState(entry: Entry): RateState {
    const last = entry.rateHistory[entry.rateHistory.length - 1];
    return last ? { status: "done", result: last } : IDLE_RATE;
  }

  function receiveFrame(entry: Entry, frame: ParsedWt901Frame): void {
    const now = deps.now();
    entry.framesReceived += 1;
    entry.lastFrameAt = now;
    entry.meter.push(now);
    entry.ring.push(now);
    if (entry.phase === "connected" && !entry.requesting && entry.link !== "streaming") publish();
    for (const listener of frameListeners) {
      try {
        listener(entry.role, frame, now);
      } catch {
        /* one failing consumer must not starve the others */
      }
    }
  }

  /** The link dropped without being asked to: start reconnecting the same device. */
  function linkDropped(entry: Entry): void {
    markDisconnected(entry);
    entry.connection = null;
    entry.linkToken += 1;
    entry.rateRuns = 0;
    if (entry.rate.status === "configuring") entry.rate = lastRateState(entry);
    entry.batteryReadLink = null;
    entry.lastError = makeError("connection_dropped", { deviceName: entry.deviceName });
    entry.skipSameDevice = false;
    if (entry.device) {
      const now = deps.now();
      entry.phase = "reconnecting";
      entry.droppedAt = now;
      entry.outageAttempts = 0;
      const step = nextReconnectStep(now, 0, now);
      entry.reconnect = {
        ...entry.reconnect,
        state: "reconnecting",
        nextAttemptAtMs: step.kind === "wait" ? step.atMs : null,
      };
      ensureTicker();
    } else {
      entry.phase = "dropped";
      stopTickerIfIdle();
    }
    publish();
  }

  function linkHandlers(
    entry: Entry,
    generation: number,
    linkToken: number,
    attempt: { dropped: boolean },
  ): SensorConnectionHandlers {
    const current = () => entry.generation === generation && entry.linkToken === linkToken;
    return {
      onFrame: (frame) => {
        if (current()) receiveFrame(entry, frame);
      },
      onStatusChange: (status) => {
        if (status !== "disconnected" || !current()) return;
        if (entry.connection && entry.phase === "connected") linkDropped(entry);
        else attempt.dropped = true;
      },
    };
  }

  function effectiveSaved(options: ConnectRoleOptions): SavedSensorBinding[] {
    const bySite = new Map<string, SavedSensorBinding>();
    for (const binding of options.savedBindings ?? []) bySite.set(bodySiteForRole(binding.role, binding.side), binding);
    if (options.patientId) {
      const prefix = `${options.patientId}:`;
      for (const [key, binding] of savedThisSession) {
        if (!key.startsWith(prefix)) continue;
        if (binding) bySite.set(key.slice(prefix.length), binding);
        else bySite.delete(key.slice(prefix.length));
      }
    }
    return [...bySite.values()];
  }

  async function persistBinding(
    entry: Entry,
    generation: number,
    options: ConnectRoleOptions,
    replaces: readonly SavedSensorBinding[],
  ): Promise<void> {
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
    const replacedSites = replaces.map((binding) => bodySiteForRole(binding.role, binding.side));
    entry.persistence = { status: "saving" };
    publish();
    let failure: string | null;
    try {
      failure = await deps.persistBinding(
        {
          patient_id: patientId,
          role: bodySite,
          device_id: deviceId,
          device_name: deviceName,
          last_connected_at: new Date(deps.now()).toISOString(),
        },
        replacedSites,
      );
    } catch (error) {
      failure = errorDetail(error);
    }
    if (!failure) {
      for (const site of replacedSites) savedThisSession.set(`${patientId}:${site}`, null);
      savedThisSession.set(`${patientId}:${bodySite}`, { role: entry.role, side, deviceId, deviceName });
    }
    if (entry.generation !== generation) return;
    entry.persistence = failure ? { status: "failed", detail: failure } : { status: "saved" };
    publish();
  }

  async function configureRate(entry: Entry, generation: number): Promise<SampleRateResult | null> {
    const connection = entry.connection;
    if (!connection || entry.generation !== generation) return null;
    const linkToken = entry.linkToken;
    const hz = requestedHz;
    entry.rateRuns += 1;
    entry.rate = { status: "configuring", requestedHz: hz };
    publish();
    const result = await connection.configureSampleRate(hz);
    if (entry.generation !== generation || entry.linkToken !== linkToken) return null;
    entry.rateRuns -= 1;
    entry.rateHistory = [...entry.rateHistory, { ...result, atMs: deps.now() }].slice(-RATE_HISTORY_LIMIT);
    // A newer run (the requested rate changed meanwhile) keeps the role in "configuring" until it finishes.
    if (entry.rateRuns === 0) entry.rate = { status: "done", result };
    publish();
    return result;
  }

  async function readBattery(entry: Entry): Promise<void> {
    const connection = entry.connection;
    if (!connection || entry.batteryReadLink === entry.linkToken) return;
    const { generation, linkToken } = entry;
    entry.batteryReadLink = linkToken;
    entry.batteryAttemptAt = deps.now();
    const result = await connection.readBattery();
    if (entry.generation !== generation || entry.linkToken !== linkToken) return;
    entry.batteryReadLink = null;
    if (result.ok) {
      entry.battery = { volts: result.volts, vendorPercent: result.vendorPercent, atMs: deps.now() };
      entry.batteryError = null;
    } else {
      entry.batteryError = result.failure;
    }
    publish();
  }

  /** After every connect and reconnect: the rate first, then the battery, on the same link. */
  async function configureThenReadBattery(entry: Entry, generation: number): Promise<void> {
    const linkToken = entry.linkToken;
    await configureRate(entry, generation);
    if (entry.generation !== generation || entry.linkToken !== linkToken) return;
    await readBattery(entry);
  }

  /** After an attempt that did not bring the link back: plan the next one, or give up once the deadline has passed. */
  function planNextAttempt(entry: Entry, failure: unknown): void {
    const now = deps.now();
    const step = nextReconnectStep(entry.droppedAt ?? now, entry.outageAttempts, now);
    if (step.kind === "give_up") {
      entry.phase = "dropped";
      entry.reconnect = { ...entry.reconnect, state: "gave_up", nextAttemptAtMs: null };
      entry.lastError = makeError("connection_dropped", { deviceName: entry.deviceName, detail: errorDetail(failure) });
      stopTickerIfIdle();
    } else {
      entry.reconnect = { ...entry.reconnect, nextAttemptAtMs: step.atMs };
    }
  }

  /**
   * A press while an automatic attempt is running takes that attempt over. Its result is ignored from here on: the
   * link token moves, so a connection it still makes is closed, and connectSensor keeps that close from touching a
   * newer link on the same device. It counts as one failed attempt of the outage, and the next automatic one is
   * planned in case the press does not bring the link back either.
   */
  function takeOverAttempt(entry: Entry): void {
    if (!entry.attemptInFlight) return;
    entry.linkToken += 1;
    entry.attemptInFlight = false;
    planNextAttempt(entry, new Error("Automatic attempt taken over by a press"));
  }

  /** One same-device attempt, on a timer or from a press. Resolves true when the link is back. */
  async function attemptReconnect(entry: Entry, pressed: boolean): Promise<boolean> {
    const device = entry.device;
    if (!device || entry.attemptInFlight) return false;
    const generation = entry.generation;
    const linkToken = (entry.linkToken += 1);
    entry.droppedAt ??= deps.now();
    entry.phase = "reconnecting";
    entry.attemptInFlight = true;
    entry.outageAttempts += 1;
    entry.reconnect = {
      ...entry.reconnect,
      state: "reconnecting",
      attempts: entry.reconnect.attempts + 1,
      nextAttemptAtMs: null,
    };
    ensureTicker();
    publish();

    const attempt = { dropped: false };
    let connection: SensorConnection | null = null;
    let failure: unknown = null;
    try {
      connection = await deps.connectDevice(
        device,
        linkHandlers(entry, generation, linkToken, attempt),
        pressed ? { timeoutMs: MANUAL_SAME_DEVICE_TIMEOUT_MS } : undefined,
      );
    } catch (error) {
      failure = error;
    }
    if (entry.generation !== generation || entry.linkToken !== linkToken) {
      connection?.disconnect();
      return false;
    }
    entry.attemptInFlight = false;
    if (connection && attempt.dropped) {
      connection.disconnect();
      connection = null;
      failure = new Error("Link dropped while reconnecting");
    }

    if (!connection) {
      planNextAttempt(entry, failure);
      publish();
      return false;
    }

    entry.connection = connection;
    entry.phase = "connected";
    markConnected(entry);
    entry.meter.reset();
    entry.droppedAt = null;
    entry.outageAttempts = 0;
    entry.skipSameDevice = false;
    entry.lastError = null;
    entry.reconnect = {
      ...entry.reconnect,
      state: "idle",
      nextAttemptAtMs: null,
      succeeded: entry.reconnect.succeeded + 1,
    };
    publish();
    void configureThenReadBattery(entry, generation);
    return true;
  }

  async function connectRole(role: SensorRole, options: ConnectRoleOptions): Promise<LiveRoleState> {
    const entry = entries[role];
    if (!isSupported()) throw new LiveSensorError(role, makeError("unsupported"));
    if (entry.press !== null || entry.requesting || entry.phase === "connecting") {
      throw new LiveSensorError(role, makeError("busy"));
    }
    const pressSeq = (entry.pressSeq += 1);
    try {
      await press(entry, options);
    } finally {
      if (entry.pressSeq === pressSeq && entry.press !== null) {
        entry.press = null;
        publish();
      }
    }
    return getSnapshot().roles[role];
  }

  /** The body of connectRole. Resolves once the role's link is up; rejects with LiveSensorError. */
  async function press(entry: Entry, options: ConnectRoleOptions): Promise<void> {
    const role = entry.role;
    // A dropped sensor is tried again as the same device first, taking over an automatic attempt that is running.
    // If that fails, this press goes on to the chooser only while it still counts as a user gesture; otherwise the
    // next press opens the chooser straight away.
    if (entry.device && (entry.phase === "dropped" || entry.phase === "reconnecting")) {
      takeOverAttempt(entry);
      if (!entry.skipSameDevice) {
        entry.press = "same_device";
        const sameGeneration = entry.generation;
        if (await attemptReconnect(entry, true)) return;
        if (entry.generation !== sameGeneration) throw new LiveSensorError(role, makeError("cancelled"));
        entry.skipSameDevice = true;
        if (!deps.hasUserActivation()) {
          entry.lastError = makeError("connect_failed", {
            deviceName: entry.deviceName,
            detail: "The sensor did not reconnect; the next press opens the device chooser",
          });
          publish();
          throw new LiveSensorError(role, entry.lastError);
        }
      }
    }

    // The chooser opens first, while the click's user activation is still fresh. Any current connection for
    // this role keeps running until a device is actually picked.
    const requestGeneration = entry.generation;
    entry.press = "choosing";
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
    const plan = planBinding(role, options.side, device.id, sessionDeviceIds, effectiveSaved(options));
    if (plan.conflict) {
      entry.lastError = makeError(
        plan.conflict.kind === "session" ? "device_bound_to_other_role" : "device_saved_for_other_role",
        { otherRole: plan.conflict.otherRole, deviceName },
      );
      publish();
      throw new LiveSensorError(role, entry.lastError);
    }

    // Picking the same sensor again keeps what was measured on it (rate history, frame counts, battery,
    // reconnects); a different sensor starts a fresh record.
    const keepRecord = device.id === entry.deviceId;
    release(entry);
    resetEntry(entry, keepRecord);
    const generation = entry.generation;
    const linkToken = (entry.linkToken += 1);
    entry.phase = "connecting";
    entry.device = device;
    entry.deviceId = device.id;
    entry.deviceName = deviceName;
    publish();

    const attempt = { dropped: false };
    let connection: SensorConnection;
    try {
      connection = await deps.connectDevice(device, linkHandlers(entry, generation, linkToken, attempt));
    } catch (error) {
      if (entry.generation !== generation) throw new LiveSensorError(role, makeError("cancelled"));
      resetEntry(entry, keepRecord);
      entry.lastError = makeError("connect_failed", { deviceName, detail: errorDetail(error) });
      publish();
      throw new LiveSensorError(role, entry.lastError);
    }
    if (entry.generation !== generation) {
      connection.disconnect();
      throw new LiveSensorError(role, makeError("cancelled"));
    }
    if (attempt.dropped) {
      connection.disconnect();
      resetEntry(entry, keepRecord);
      entry.lastError = makeError("connect_failed", { deviceName, detail: "Link dropped while connecting" });
      publish();
      throw new LiveSensorError(role, entry.lastError);
    }

    entry.connection = connection;
    entry.phase = "connected";
    markConnected(entry);
    ensureTicker();
    publish();
    void persistBinding(entry, generation, options, plan.replaces);
    void configureThenReadBattery(entry, generation);
  }

  function disconnectRole(role: SensorRole): void {
    const entry = entries[role];
    release(entry);
    resetEntry(entry);
    endPress(entry);
    stopTickerIfIdle();
    publish();
  }

  function setRequestedRate(hz: SupportedRateHz): void {
    const next: SupportedRateHz = hz === 100 ? 100 : TARGET_SAMPLE_RATE_HZ;
    if (next === requestedHz) return;
    requestedHz = next;
    for (const role of SENSOR_ROLE_ORDER) {
      const entry = entries[role];
      if (entry.phase === "connected") void configureRate(entry, entry.generation);
    }
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
        endPress(entries[role]);
      }
      stopTickerIfIdle();
      publish();
    },
    reconfigureRate: (role) => configureRate(entries[role], entries[role].generation),
    setRequestedRate,
    getRequestedRate: () => requestedHz,
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
  persistBinding: async (row, replacedRoles) => {
    supabase ??= createClient();
    if (replacedRoles.length > 0) {
      // The other leg's row for this device goes first: the unique (patient_id, device_id) index would refuse the
      // upsert while it exists, and ON CONFLICT only resolves (patient_id, role). Not atomic; if the upsert then
      // fails, the row it removed was stale anyway and the next connect saves the binding again.
      const { error } = await supabase
        .from("patient_ble_devices")
        .delete()
        .eq("patient_id", row.patient_id)
        .eq("device_id", row.device_id)
        .in("role", [...replacedRoles]);
      if (error) return error.message;
    }
    const { error } = await supabase.from("patient_ble_devices").upsert(row, { onConflict: "patient_id,role" });
    return error ? error.message : null;
  },
  hasUserActivation: () =>
    typeof navigator === "undefined" || !("userActivation" in navigator) || navigator.userActivation.isActive,
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
export const setRequestedRate = store.setRequestedRate;
export const getRequestedRate = store.getRequestedRate;
export const subscribeFrames = store.subscribeFrames;
export const subscribe = store.subscribe;
export const getSnapshot = store.getSnapshot;

export function getServerSnapshot(): LiveSensorsSnapshot {
  return SERVER_SNAPSHOT;
}

/**
 * Per-role link, device (with short id), requested rate and every rate readback, delivered Hz, rolling and total
 * frame counts, connected time, battery, reconnect state, persistence and last error.
 */
export function useLiveSensors(): LiveSensorsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
