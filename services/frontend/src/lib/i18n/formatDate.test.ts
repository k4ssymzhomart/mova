import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDate } from "./formatDate.ts";

// 05:21 UTC on Sunday 13 September 2026 is 10:21 in Almaty (UTC+5).
const instant = new Date("2026-09-13T05:21:00Z");

test("Kazakh is assembled from names, not left to ICU", () => {
  assert.equal(formatDate(instant, "kk", "weekday", "Asia/Almaty"), "13 қыркүйек, жексенбі");
  assert.equal(formatDate(instant, "kk", "date", "Asia/Almaty"), "2026 жылғы 13 қыркүйек");
  assert.equal(formatDate(instant, "kk", "dateTime", "Asia/Almaty"), "2026 жылғы 13 қыркүйек, 10:21");
  assert.equal(formatDate(instant, "kk", "time", "UTC"), "05:21");
  assert.equal(formatDate(instant, "kk", "dayMonth", "UTC"), "13 қыркүйек");
});

test("the timezone decides the calendar day", () => {
  const lateUtc = new Date("2026-09-12T20:00:00Z");
  assert.equal(formatDate(lateUtc, "kk", "dayMonth", "Asia/Almaty"), "13 қыркүйек");
  assert.equal(formatDate(lateUtc, "kk", "dayMonth", "UTC"), "12 қыркүйек");
});

test("Russian and English go through Intl", () => {
  assert.equal(formatDate(instant, "ru", "dayMonth", "UTC"), "13 сентября");
  assert.equal(formatDate(instant, "en", "dayMonth", "UTC"), "13 September");
});
