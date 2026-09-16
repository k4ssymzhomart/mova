/// <reference types="web-bluetooth" />

// simulation — the gate in front of the simulated sensors (simulatedWt901.ts), for recording the Heel Slide path on
// `next dev` without hardware. The simulation exists only when the server runs in development AND
// NEXT_PUBLIC_SENSOR_SIMULATION is "1"; in every other build nothing here does anything.
//
// It is separate from the mock (NEXT_PUBLIC_SENSOR_MOCK, lib/sensors/useSensorStatus), which only cycles link states
// for reviewers and can never start a session. The simulation instead stands in for Web Bluetooth underneath the
// live sensor store: its frames drive the counter and are recorded, so everything it touches is marked simulated
// (the sensor source, device_info, every frame's imu, the summary) and a banner says so on screen.
//
// Each dynamic import sits inside its own `if` that repeats the whole condition. The bundler can only drop a branch
// whose condition is a literal after NODE_ENV is inlined, not one behind a variable, so in a production build these
// branches, and with them simulatedWt901.ts, are gone.

import type { SensorRole } from "./roles";

export const SIMULATION_ENABLED =
  process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_SENSOR_SIMULATION === "1";

/** The simulated sensor for a role, standing in for the browser's device chooser. Rejects when not simulating. */
export async function requestSimulatedDevice(role: SensorRole): Promise<BluetoothDevice> {
  if (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_SENSOR_SIMULATION === "1") {
    const simulation = await import("./simulatedWt901");
    return simulation.simulatedDevice(role);
  }
  throw new Error("Sensor simulation is off");
}

/**
 * The exercise screen calls this when counting starts: the simulated leg then runs its ten heel slides. A no-op
 * unless simulating, and while a run is still going.
 */
export function startSimulatedMovement(): void {
  if (process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_SENSOR_SIMULATION === "1") {
    void import("./simulatedWt901").then((simulation) => simulation.startMovement());
  }
}
