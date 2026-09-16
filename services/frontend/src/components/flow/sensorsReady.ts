// When the sensors step lets «Далее» open a session. Pure, so the node tests pin it for every source and mode.
//
// Only sensors that produce frames for the session may start one: the real transport, or the development simulation
// while it is actually on. The mock never does, in any build, whatever else is on: it only cycles link states for
// reviewers and would open a session no frame could ever reach.

import type { SensorSource } from "@/lib/sensors/types";

export function sensorsStepReady(source: SensorSource, allStreaming: boolean, simulationEnabled: boolean): boolean {
  if (!allStreaming) return false;
  if (source === "ble") return true;
  return source === "simulated" && simulationEnabled;
}
