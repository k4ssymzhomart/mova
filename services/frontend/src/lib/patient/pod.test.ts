import assert from "node:assert/strict";
import { test } from "node:test";

import { computePostOpDay } from "./pod.ts";

const ALMATY_POD0 = { surgeryDayIs: 0 as const, timeZone: "Asia/Almaty" };
const now = new Date("2026-09-13T08:00:00Z");

test("no surgery date: unknown, never estimated", () => {
  assert.deepEqual(computePostOpDay(null, now, ALMATY_POD0), { status: "unknown", reason: "no-surgery-date" });
});

test("no confirmed convention: no day number, even with a date", () => {
  assert.deepEqual(computePostOpDay("2026-09-10", now, null), { status: "unknown", reason: "convention-pending" });
});

test("impossible or malformed dates are rejected", () => {
  assert.equal(computePostOpDay("2026-02-30", now, ALMATY_POD0).status, "unknown");
  assert.equal(computePostOpDay("10.09.2026", now, ALMATY_POD0).status, "unknown");
});

test("the day boundary is taken in the configured timezone, not UTC", () => {
  // 20:00 UTC on 12 September is already 01:00 on 13 September in Almaty (UTC+5).
  const lateUtc = new Date("2026-09-12T20:00:00Z");
  const almaty = computePostOpDay("2026-09-10", lateUtc, ALMATY_POD0);
  const utc = computePostOpDay("2026-09-10", lateUtc, { surgeryDayIs: 0, timeZone: "UTC" });
  assert.equal(almaty.status === "known" && almaty.day, 3);
  assert.equal(utc.status === "known" && utc.day, 2);
});

test("the day of surgery is numbered by the convention", () => {
  const surgeryDay = new Date("2026-09-10T06:00:00Z");
  assert.deepEqual(computePostOpDay("2026-09-10", surgeryDay, ALMATY_POD0), {
    status: "known",
    day: 0,
    surgeryDate: "2026-09-10",
    isSurgeryDay: true,
  });
  const pod1 = computePostOpDay("2026-09-10", surgeryDay, { surgeryDayIs: 1, timeZone: "Asia/Almaty" });
  assert.equal(pod1.status === "known" && pod1.day, 1);
  assert.equal(pod1.status === "known" && pod1.isSurgeryDay, true);
});

test("a future date is a scheduled surgery, not a negative day", () => {
  assert.deepEqual(computePostOpDay("2026-09-20", now, ALMATY_POD0), { status: "scheduled", surgeryDate: "2026-09-20" });
});
