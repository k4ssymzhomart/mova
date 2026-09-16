"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

import { connectWt901Sensor, type BleConnectionStatus, type SensorConnection } from "./connectSensor";
import { SENSOR_ROLE_ORDER, bodySiteForRole, type SensorRole, type Side } from "./roles";
import type { ParsedWt901Frame } from "./wt901ble68";

export type SensorUiStatus = "idle" | "requesting" | "connecting" | "connected" | "error";

const IDLE: Record<SensorRole, SensorUiStatus> = { thigh: "idle", shank: "idle", foot: "idle" };

function mapStatus(status: BleConnectionStatus): SensorUiStatus {
  if (status === "connected") return "connected";
  if (status === "requesting") return "requesting";
  if (status === "connecting") return "connecting";
  return "error"; // disconnected | error
}

export interface UseSensorConnectResult {
  statuses: Record<SensorRole, SensorUiStatus>;
  deviceNames: Partial<Record<SensorRole, string | null>>;
  connect: (role: SensorRole) => Promise<void>;
  forget: (role: SensorRole) => Promise<void>;
  connectedCount: number;
  allConnected: boolean;
  bleSupported: boolean;
}

/**
 * Sequential Web Bluetooth pairing of the three WT901BLE68 sensors, one role
 * at a time -- ported from Phoenix's `useSensorConnect`. Each `connect(role)`
 * opens the browser's native device picker (must run from a click handler),
 * streams parsed frames to `onFrame`, and persists the pairing to
 * `patient_ble_devices` so it survives reloads and is visible to clinicians,
 * unlike Phoenix's localStorage-only version.
 *
 * The physical GATT connection itself never survives a reload (Web Bluetooth
 * requires a fresh user gesture per browser session) -- only the *identity*
 * of what was last paired to each role does.
 */
export function useSensorConnect(
  patientId: string | null,
  side: Side | null,
  initialDeviceNames: Partial<Record<SensorRole, string | null>>,
  onFrame: (role: SensorRole, frame: ParsedWt901Frame) => void
): UseSensorConnectResult {
  const supabaseRef = useRef(createClient());
  const [statuses, setStatuses] = useState<Record<SensorRole, SensorUiStatus>>({ ...IDLE });
  const [deviceNames, setDeviceNames] =
    useState<Partial<Record<SensorRole, string | null>>>(initialDeviceNames);
  const connectionsRef = useRef<Partial<Record<SensorRole, SensorConnection>>>({});
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const connect = useCallback(
    async (role: SensorRole) => {
      if (!patientId || !side) return;
      setStatuses((s) => ({ ...s, [role]: "requesting" }));
      try {
        const connection = await connectWt901Sensor({
          onStatusChange: (st) => setStatuses((s) => ({ ...s, [role]: mapStatus(st) })),
          onFrame: (frame) => onFrameRef.current(role, frame),
          onError: () => setStatuses((s) => ({ ...s, [role]: "error" })),
        });
        connectionsRef.current[role] = connection;
        setDeviceNames((s) => ({ ...s, [role]: connection.deviceName }));

        await supabaseRef.current.from("patient_ble_devices").upsert(
          {
            patient_id: patientId,
            role: bodySiteForRole(role, side),
            device_id: connection.deviceId,
            device_name: connection.deviceName,
            last_connected_at: new Date().toISOString(),
          },
          { onConflict: "patient_id,role" }
        );
      } catch {
        setStatuses((s) => ({ ...s, [role]: "error" }));
      }
    },
    [patientId, side]
  );

  const forget = useCallback(
    async (role: SensorRole) => {
      connectionsRef.current[role]?.disconnect();
      delete connectionsRef.current[role];
      setStatuses((s) => ({ ...s, [role]: "idle" }));
      setDeviceNames((s) => ({ ...s, [role]: undefined }));
      if (!patientId || !side) return;
      await supabaseRef.current
        .from("patient_ble_devices")
        .delete()
        .eq("patient_id", patientId)
        .eq("role", bodySiteForRole(role, side));
    },
    [patientId, side]
  );

  // Disconnect only when the flow unmounts -- not on step/role changes.
  useEffect(() => {
    return () => {
      for (const c of Object.values(connectionsRef.current)) c?.disconnect();
    };
  }, []);

  const connectedCount = SENSOR_ROLE_ORDER.filter((r) => statuses[r] === "connected").length;
  const bleSupported = typeof navigator !== "undefined" && "bluetooth" in navigator;

  return {
    statuses,
    deviceNames,
    connect,
    forget,
    connectedCount,
    allConnected: connectedCount === SENSOR_ROLE_ORDER.length,
    bleSupported,
  };
}
