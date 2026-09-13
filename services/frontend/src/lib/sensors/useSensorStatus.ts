"use client";

// useSensorStatus — the one hook the UI reads for the three sensor roles. What sits behind it today:
//  - "none": there is no transport yet, so every role reads "disconnected", or "unsupported" in browsers
//    without Web Bluetooth (Safari and every iOS browser).
//  - "mock": NEXT_PUBLIC_SENSOR_MOCK=1, for walking through the flow without hardware. Refused on the
//    production Vercel deployment, and always announced on screen by MockSensorBanner. Battery stays null:
//    a mock never invents device readings.
//
// TODO(#21): replace the "none" branch with the real Web Bluetooth transport, behind the same snapshot.

import { useSyncExternalStore } from "react";

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

const MOCK_CYCLE: readonly SensorLink[] = ["streaming", "connecting", "lost", "disconnected", "unsupported"];
let mockLinks: Record<SensorRole, SensorLink> = { thigh: "streaming", shank: "streaming", foot: "streaming" };
let mockSnapshot = build("mock", mockLinks);
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SensorStatusSnapshot {
  if (SENSOR_MOCK_ENABLED) return mockSnapshot;
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
