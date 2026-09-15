import assert from "node:assert/strict";
import { test } from "node:test";

import type { SensorLink } from "@/lib/sensors/types";

import {
  MAX_BASELINE_WINDOWS,
  appendBaselineWindow,
  baselineWindowsKey,
  exerciseRouteFor,
  missingCountingRoles,
  parseBaselineWindows,
  pauseMessageKey,
  recordedFlagKey,
  restartNoticeKey,
} from "./exerciseStatus.ts";

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

test("the zeros of every start are kept per session, apart from the recorded flag", () => {
  assert.notEqual(baselineWindowsKey("a"), baselineWindowsKey("b"));
  assert.notEqual(baselineWindowsKey("a"), recordedFlagKey("a"));
});

test("a stored list of zeros: nothing stored is empty, anything but a list is unknown, bad spans are left out", () => {
  assert.deepEqual(parseBaselineWindows(null), []);
  assert.equal(parseBaselineWindows("not json"), null);
  assert.equal(parseBaselineWindows('{"start":1,"end":2}'), null);
  assert.deepEqual(
    parseBaselineWindows(
      JSON.stringify([
        { start: 70_000, end: 70_500 },
        { start: "1", end: 500 },
        { start: 900, end: 900 },
        { start: 10_000, end: 10_500, extra: true },
      ]),
    ),
    [
      { start: 10_000, end: 10_500 },
      { start: 70_000, end: 70_500 },
    ],
  );
});

test("appending a zero keeps time order, replaces a repeated start and stays bounded", () => {
  const first = { start: 10_000, end: 10_500 };
  const second = { start: 70_000, end: 70_500 };
  assert.deepEqual(appendBaselineWindow([], first), [first]);
  assert.deepEqual(appendBaselineWindow([first], second), [first, second]);
  assert.deepEqual(appendBaselineWindow([second], first), [first, second]);
  assert.deepEqual(appendBaselineWindow([first], { start: 10_000, end: 10_600 }), [{ start: 10_000, end: 10_600 }]);
  assert.deepEqual(appendBaselineWindow([first], { start: 5, end: Number.NaN }), [first]);

  let list: { start: number; end: number }[] = [];
  for (let i = 0; i < MAX_BASELINE_WINDOWS + 5; i += 1) list = appendBaselineWindow(list, { start: i * 1000, end: i * 1000 + 500 });
  assert.equal(list.length, MAX_BASELINE_WINDOWS);
  assert.equal(list[list.length - 1].start, (MAX_BASELINE_WINDOWS + 4) * 1000);
});

test("after a reload, only a kept earlier zero lets the patient skip reps already done", () => {
  assert.equal(restartNoticeKey(1), "flow.exercise.restarted");
  assert.equal(restartNoticeKey(3), "flow.exercise.restarted");
  assert.equal(restartNoticeKey(0), "flow.exercise.restartedFullSet");
  assert.equal(restartNoticeKey(null), "flow.exercise.restartedFullSet");
});
