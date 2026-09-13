// The contract between the patient app and the sensor transport: three WitMotion IMUs bound to explicit
// roles (thigh / shank / foot). The UI only ever reads this snapshot. Discovery, pairing, role binding,
// battery, signal quality and reconnection all belong to the transport.
//
// TODO(#21): the real Web Bluetooth layer implements this. The shape is a proposal for that issue's owner;
// change it there and this file follows.

export type SensorRole = "thigh" | "shank" | "foot";

export const SENSOR_ROLES: readonly SensorRole[] = ["thigh", "shank", "foot"];

/**
 * - unsupported: this browser has no Web Bluetooth (Safari, every iOS browser). Never shown as "disconnected",
 *   because that would tell the patient to fix something they cannot fix.
 * - disconnected: supported, nothing bound to this role yet.
 * - connecting: pairing or reconnecting.
 * - streaming: frames are arriving.
 * - lost: was streaming, stopped.
 */
export type SensorLink = "unsupported" | "disconnected" | "connecting" | "streaming" | "lost";

export interface SensorState {
  role: SensorRole;
  link: SensorLink;
  /** Reported by the device. null until the transport has read it; never estimated. */
  batteryPct: number | null;
  /** Epoch ms of the last frame, null if none yet. */
  lastSampleAt: number | null;
}

export type SensorSource = "none" | "mock" | "ble";

export interface SensorStatusSnapshot {
  /** "mock" must always be visible to the patient (see MockSensorBanner). */
  source: SensorSource;
  sensors: Record<SensorRole, SensorState>;
  /** True only when all three roles are streaming (НТЗ AC-03). */
  allStreaming: boolean;
}
