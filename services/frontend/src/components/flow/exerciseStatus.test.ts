import assert from "node:assert/strict";
import { test } from "node:test";

import type { SensorLink } from "@/lib/sensors/types";

import { exerciseRouteFor, missingCountingRoles, pauseMessageKey, recordedFlagKey } from "./exerciseStatus.ts";

const links = (thigh: SensorLink, shank: SensorLink, foot: SensorLink) => ({
  thigh: { link: thigh },
  shank: { link: shank },
  foot: { link: foot },
});

test("only the thigh and shank sensors pause counting", () => {
  assert.deepEqual(missingCountingRoles(links("streaming", "streaming", "lost")), []);
  assert.deepEqual(missingCountingRoles(links("connecting", "streaming", "streaming")), ["thigh"]);
  assert.deepEqual(missingCountingRoles(links("streaming", "lost", "disconnected")), ["shank"]);
  assert.deepEqual(missingCountingRoles(links("lost", "disconnected", "streaming")), ["thigh", "shank"]);
});

test("the pause line names every missing counting sensor", () => {
  assert.equal(pauseMessageKey([]), null);
  assert.equal(pauseMessageKey(["thigh"]), "flow.exercise.pause.thigh");
  assert.equal(pauseMessageKey(["shank"]), "flow.exercise.pause.shank");
  assert.equal(pauseMessageKey(["thigh", "shank"]), "flow.exercise.pause.both");
});

test("only a session in progress keeps the exercise screen", () => {
  assert.equal(exerciseRouteFor("in_progress"), "stay");
  assert.equal(exerciseRouteFor("completed"), "checkIn");
  assert.equal(exerciseRouteFor("reviewed"), "summary");
  assert.equal(exerciseRouteFor("aborted"), "summary");
  assert.equal(exerciseRouteFor("scheduled"), "refresh");
  assert.equal(exerciseRouteFor("something new"), "refresh");
});

test("the recorded flag is per session", () => {
  assert.notEqual(recordedFlagKey("a"), recordedFlagKey("b"));
});
