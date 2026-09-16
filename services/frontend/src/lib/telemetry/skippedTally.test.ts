import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import { SKIPPED_TALLY_MAX_SESSIONS, SkippedTally } from "./skippedTally";

let dbCounter = 0;
function freshTally(): SkippedTally {
  dbCounter += 1;
  return new SkippedTally(`test-mova-telemetry-skipped-${dbCounter}`);
}

describe("SkippedTally", () => {
  it("adds up per session and keeps when the first and the latest skips were counted", async () => {
    const tally = freshTally();
    await tally.add("s1", { frames: 20, events: 0 }, 100);
    await tally.add("s2", { frames: 3, events: 0 }, 150);
    await tally.add("s1", { frames: 5, events: 1 }, 200);
    await tally.add("s3", { frames: 0, events: 0 }, 300); // nothing skipped: no entry

    expect(await tally.read("s1")).toEqual({ sessionId: "s1", frames: 25, events: 1, firstAtMs: 100, lastAtMs: 200 });
    expect(await tally.read("s3")).toBeNull();
    expect((await tally.list()).map((entry) => entry.sessionId)).toEqual(["s1", "s2"]);
  });

  it("keeps only the most recently updated sessions", async () => {
    const tally = freshTally();
    for (let i = 0; i <= SKIPPED_TALLY_MAX_SESSIONS; i += 1) {
      await tally.add(`s${i}`, { frames: 1, events: 0 }, 1000 + i);
    }

    const entries = await tally.list();
    expect(entries).toHaveLength(SKIPPED_TALLY_MAX_SESSIONS);
    expect(await tally.read("s0")).toBeNull();
    expect(await tally.read(`s${SKIPPED_TALLY_MAX_SESSIONS}`)).toMatchObject({ frames: 1 });
  });

  it("never throws while counting when IndexedDB is unavailable, while reads reject", async () => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      const tally = freshTally();
      await tally.add("s1", { frames: 4, events: 0 });
      await expect(tally.read("s1")).rejects.toThrow("IndexedDB unavailable");
      await expect(tally.list()).rejects.toThrow("IndexedDB unavailable");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
