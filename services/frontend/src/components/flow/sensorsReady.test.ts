import assert from "node:assert/strict";
import { test } from "node:test";

import type { SensorSource } from "@/lib/sensors/types";

import { sensorsStepReady } from "./sensorsReady.ts";

const SOURCES: readonly SensorSource[] = ["none", "mock", "ble", "simulated"];

test("the mock never opens a session, with or without the simulation, streaming or not", () => {
  for (const simulationEnabled of [false, true]) {
    for (const allStreaming of [false, true]) {
      assert.equal(sensorsStepReady("mock", allStreaming, simulationEnabled), false);
    }
  }
});

test("the simulated source opens a session only while the simulation is enabled", () => {
  assert.equal(sensorsStepReady("simulated", true, true), true);
  assert.equal(sensorsStepReady("simulated", true, false), false);
  assert.equal(sensorsStepReady("simulated", false, true), false);
});

test("real sensors open a session once all three stream, whatever the simulation flag says", () => {
  assert.equal(sensorsStepReady("ble", true, false), true);
  assert.equal(sensorsStepReady("ble", true, true), true);
  assert.equal(sensorsStepReady("ble", false, false), false);
});

test("nothing opens a session before all three stream, or with no sensor source", () => {
  for (const source of SOURCES) {
    for (const simulationEnabled of [false, true]) {
      assert.equal(sensorsStepReady(source, false, simulationEnabled), false);
    }
  }
  assert.equal(sensorsStepReady("none", true, true), false);
  assert.equal(sensorsStepReady("none", true, false), false);
});
