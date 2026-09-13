import assert from "node:assert/strict";
import { test } from "node:test";

import { flowLocation, stepHref } from "./steps.ts";

test("step 1 lives under /app/session/new/<prescriptionId>", () => {
  assert.deepEqual(flowLocation("/app/session/new/rx-1"), { step: "sensors", prescriptionId: "rx-1", sessionId: null });
});

test("later steps live under /app/session/<id>/<step>", () => {
  assert.equal(flowLocation("/app/session/s1/calibrate").step, "calibrate");
  assert.equal(flowLocation("/app/session/s1/exercise").step, "exercise");
  assert.equal(flowLocation("/app/session/s1/check-in").step, "checkIn");
  assert.equal(flowLocation("/app/session/s1/summary").step, "summary");
  assert.deepEqual(flowLocation("/app/session/s1/stop"), { step: "stop", prescriptionId: null, sessionId: "s1" });
});

test("routes that are not a step have no step", () => {
  assert.equal(flowLocation("/app/session/new").step, null);
  assert.equal(flowLocation("/app/session/s1").step, null);
  assert.equal(flowLocation("/app").step, null);
  assert.equal(flowLocation("/program/rx-1").step, null);
});

test("stepHref builds the URL a step lives at", () => {
  assert.equal(stepHref("s1", "checkIn"), "/app/session/s1/check-in");
});
