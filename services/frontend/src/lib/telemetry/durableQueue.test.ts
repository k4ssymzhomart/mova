import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import type { FrameRow } from "./buffer";
import { DurableQueue } from "./durableQueue";

function frame(seq: number): FrameRow {
  return { recorded_at: "2026-01-01T00:00:00.000Z", seq };
}

let dbCounter = 0;
/** Each test gets its own database -- avoids cross-test interference without needing to
 * await a deleteDatabase() against a connection a previous test may still hold open. */
function freshQueue(): DurableQueue {
  dbCounter += 1;
  return new DurableQueue(`test-mova-telemetry-${dbCounter}`);
}

describe("DurableQueue", () => {
  it("returns null for a session that was never saved", async () => {
    expect(await freshQueue().load("session-a")).toBeNull();
  });

  it("round-trips a saved batch", async () => {
    const queue = freshQueue();
    await queue.save("session-a", [frame(0), frame(1)], []);
    const loaded = await queue.load("session-a");

    expect(loaded?.sessionId).toBe("session-a");
    expect(loaded?.frames).toEqual([frame(0), frame(1)]);
    expect(loaded?.events).toEqual([]);
  });

  it("overwrites wholesale on a second save rather than appending", async () => {
    const queue = freshQueue();
    await queue.save("session-a", [frame(0)], []);
    await queue.save("session-a", [frame(1), frame(2)], []);
    const loaded = await queue.load("session-a");

    expect(loaded?.frames).toEqual([frame(1), frame(2)]);
  });

  it("clear removes only that session's record", async () => {
    const queue = freshQueue();
    await queue.save("session-a", [frame(0)], []);
    await queue.save("session-b", [frame(9)], []);

    await queue.clear("session-a");

    expect(await queue.load("session-a")).toBeNull();
    expect((await queue.load("session-b"))?.frames).toEqual([frame(9)]);
  });

  it("keeps separate sessions isolated", async () => {
    const queue = freshQueue();
    await queue.save("session-a", [frame(0)], []);
    await queue.save("session-b", [frame(1)], []);

    expect((await queue.load("session-a"))?.frames).toEqual([frame(0)]);
    expect((await queue.load("session-b"))?.frames).toEqual([frame(1)]);
  });

  it("lists stored sessions and round-trips the owner and a rejection mark", async () => {
    const queue = freshQueue();
    await queue.save("session-a", [frame(0)], [], { ownerId: "user-1" });
    await queue.save("session-b", [frame(1)], [], {
      ownerId: "user-1",
      rejected: { code: "42501", message: "session not found for caller", atMs: 5 },
    });
    await queue.save("session-c", [frame(2)], []);

    expect((await queue.listSessionIds()).sort()).toEqual(["session-a", "session-b", "session-c"]);
    expect(await queue.read("session-a")).toMatchObject({ ownerId: "user-1" });
    expect((await queue.read("session-a"))?.rejected).toBeUndefined();
    expect((await queue.read("session-b"))?.rejected).toEqual({
      code: "42501",
      message: "session not found for caller",
      atMs: 5,
    });
    expect((await queue.read("session-c"))?.ownerId).toBeUndefined();
    expect(await queue.read("missing")).toBeNull();
  });

  it("read and listSessionIds reject when IndexedDB is unavailable, while load still answers null", async () => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      const queue = freshQueue();
      await expect(queue.read("session-a")).rejects.toThrow("IndexedDB unavailable");
      await expect(queue.listSessionIds()).rejects.toThrow("IndexedDB unavailable");
      expect(await queue.load("session-a")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
