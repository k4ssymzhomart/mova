import assert from "node:assert/strict";
import { test } from "node:test";

import { activeHref } from "./match.ts";

const NAV = [{ href: "/app" }, { href: "/program" }, { href: "/progress" }, { href: "/care-team" }, { href: "/settings" }];

test("a nav route highlights itself", () => {
  for (const { href } of NAV) assert.equal(activeHref(href, NAV), href);
});

test("every exercise-flow route highlights Today", () => {
  assert.equal(activeHref("/app/session/new/rx-1", NAV), "/app");
  assert.equal(activeHref("/app/session/abc/calibrate", NAV), "/app");
  assert.equal(activeHref("/app/session/abc/stop", NAV), "/app");
});

test("detail routes highlight their parent", () => {
  assert.equal(activeHref("/program/rx-1", NAV), "/program");
  assert.equal(activeHref("/progress/session-1", NAV), "/progress");
});

test("a prefix only matches at a segment boundary", () => {
  assert.equal(activeHref("/programs", NAV), null);
  assert.equal(activeHref("/application", NAV), null);
});

test("the longest match wins", () => {
  const items = [{ href: "/app" }, { href: "/app/session/new", match: "/app/session" }];
  assert.equal(activeHref("/app/session/abc/exercise", items), "/app/session/new");
  assert.equal(activeHref("/app", items), "/app");
});

test("routes outside the nav highlight nothing", () => {
  assert.equal(activeHref("/devices", NAV), null);
  assert.equal(activeHref("/", NAV), null);
});
