"use client";

// useSensorStatus — the one hook the UI reads for the three sensor roles. What sits behind it:
//  - "ble": the real Web Bluetooth store (lib/ble/liveSensors) as soon as any role is connecting, streaming or
//    lost. Battery stays null: the WT901BLE68 data frame carries none and nothing reads it separately.
//  - "none": nothing connected yet, so every role reads "disconnected", or "unsupported" in browsers without
//    Web Bluetooth (Safari and every iOS browser).
//  - "mock": NEXT_PUBLIC_SENSOR_MOCK=1, for walking through the flow without hardware. Refused on the
//    production Vercel deployment, and always announced on screen by MockSensorBanner. Battery stays null:
//    a mock never invents device readings. The live store is not consulted while the mock is on.

import { useSyncExternalStore } from "react";

import {
  getSnapshot as getLiveSnapshot,
  subscribe as subscribeLive,
  type LiveSensorsSnapshot,
} from "@/lib/ble/liveSensors";

import {
  SENSOR_ROLES,
  type SensorLink,
  type SensorRole,
  type SensorSource,
  type SensorStatusSnapshot,
} from "./types";

export const SENSOR_MOCK_ENABLED =
  process.env.NEXT_PUBLIC_SENSOR_MOCK === "1" && process.env.NEXT_PUBLIC_VERCEL_ENV !== "production";

function build(source: SensorSource, links: Record<SensorRole, SensorLink>): SensorStatusSnapshot {
  const sensors = {} as SensorStatusSnapshot["sensors"];
  for (const role of SENSOR_ROLES) sensors[role] = { role, link: links[role], batteryPct: null, lastSampleAt: null };
  return { source, sensors, allStreaming: SENSOR_ROLES.every((role) => links[role] === "streaming") };
}

const SERVER_SNAPSHOT = build("none", { thigh: "disconnected", shank: "disconnected", foot: "disconnected" });

let noneSnapshot: SensorStatusSnapshot | null = null;

// Derived once per live snapshot, so useSyncExternalStore sees a stable object between store updates.
let bleSource: LiveSensorsSnapshot | null = null;
let bleSnapshot: SensorStatusSnapshot | null = null;

const MOCK_CYCLE: readonly SensorLink[] = ["streaming", "connecting", "lost", "disconnected", "unsupported"];
let mockLinks: Record<SensorRole, SensorLink> = { thigh: "streaming", shank: "streaming", foot: "streaming" };
let mockSnapshot = build("mock", mockLinks);
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const unsubscribeLive = SENSOR_MOCK_ENABLED ? null : subscribeLive(listener);
  return () => {
    listeners.delete(listener);
    unsubscribeLive?.();
  };
}

function fromLive(live: LiveSensorsSnapshot): SensorStatusSnapshot {
  if (live === bleSource && bleSnapshot) return bleSnapshot;
  const sensors = {} as SensorStatusSnapshot["sensors"];
  for (const role of SENSOR_ROLES) {
    const state = live.roles[role];
    sensors[role] = { role, link: state.link, batteryPct: null, lastSampleAt: state.lastSampleAt };
  }
  bleSource = live;
  bleSnapshot = { source: "ble", sensors, allStreaming: live.allStreaming };
  return bleSnapshot;
}

function getSnapshot(): SensorStatusSnapshot {
  if (SENSOR_MOCK_ENABLED) return mockSnapshot;
  const live = getLiveSnapshot();
  if (live.active) return fromLive(live);
  if (!noneSnapshot) {
    const link: SensorLink = "bluetooth" in navigator ? "disconnected" : "unsupported";
    noneSnapshot = build("none", { thigh: link, shank: link, foot: link });
  }
  return noneSnapshot;
}

/** Mock only: move one role to its next link state, so a reviewer can see every status. */
export function cycleMockSensor(role: SensorRole): void {
  if (!SENSOR_MOCK_ENABLED) return;
  const next = MOCK_CYCLE[(MOCK_CYCLE.indexOf(mockLinks[role]) + 1) % MOCK_CYCLE.length];
  mockLinks = { ...mockLinks, [role]: next };
  mockSnapshot = build("mock", mockLinks);
  listeners.forEach((listener) => listener());
}

export function useSensorStatus(): SensorStatusSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}
