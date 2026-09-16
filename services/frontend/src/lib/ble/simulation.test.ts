import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadGate(nodeEnv: string, flag: string | undefined) {
  vi.stubEnv("NODE_ENV", nodeEnv);
  vi.stubEnv("NEXT_PUBLIC_SENSOR_SIMULATION", flag ?? "");
  vi.resetModules();
  return import("./simulation");
}

describe("the simulation gate", () => {
  it("is open only in development with NEXT_PUBLIC_SENSOR_SIMULATION=1, and then hands out a role's simulated sensor", async () => {
    const gate = await loadGate("development", "1");
    expect(gate.SIMULATION_ENABLED).toBe(true);
    const device = await gate.requestSimulatedDevice("shank");
    expect(device.id).toBe("simulated-shank");
    expect(await gate.requestSimulatedDevice("shank")).toBe(device);
  });

  it("stays shut in production even with the flag, and in development without it", async () => {
    for (const [nodeEnv, flag] of [
      ["production", "1"],
      ["test", "1"],
      ["development", undefined],
      ["development", "true"],
    ] as const) {
      const gate = await loadGate(nodeEnv, flag);
      expect(gate.SIMULATION_ENABLED).toBe(false);
      await expect(gate.requestSimulatedDevice("thigh")).rejects.toThrow("Sensor simulation is off");
      expect(() => gate.startSimulatedMovement()).not.toThrow();
    }
  });
});
