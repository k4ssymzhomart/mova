import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import type { FogEventRow, FrameRow } from "./buffer";
import { DurableQueue, eventKey, frameKey, type RecordLease, type SettleRequest } from "./durableQueue";

function frame(seq: number): FrameRow {
  return { recorded_at: "2026-01-01T00:00:00.000Z", seq };
}

function lease(owner: string, expiresAtMs: number, kind: RecordLease["kind"] = "recording"): RecordLease {
  return { owner, kind, expiresAtMs };
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

  it("settle removes only the delivered rows from the record as it is now, and deletes it once nothing is left", async () => {
    const queue = freshQueue();
    const episode: FogEventRow = {
      kind: "episode",
      started_at: "2026-01-01T00:00:01.000Z",
      ended_at: null,
      confidence: 0.8,
      freeze_index: null,
      source: "test",
    };
    await queue.save("s", [frame(0), frame(1), frame(2)], [episode], { ownerId: "user-1" });
    // A recording rewrote the record with a newer row after the outbox read it.
    await queue.save("s", [frame(0), frame(1), frame(2), frame(3)], [episode], { ownerId: "user-1" });

    const delivered = (seqs: number[], events: FogEventRow[] = []) => ({
      deliveredFrames: seqs.map((seq) => frameKey(frame(seq))),
      deliveredEvents: events.map(eventKey),
      owner: null,
      nowMs: 10,
    });
    expect(await queue.settle("s", delivered([0, 1], [episode]))).toBe("saved");
    expect(await queue.read("s")).toMatchObject({ frames: [frame(2), frame(3)], events: [], ownerId: "user-1" });

    expect(await queue.settle("s", delivered([]))).toBe("saved"); // nothing to change
    expect(await queue.settle("s", delivered([2, 3]))).toBe("cleared");
    expect(await queue.read("s")).toBeNull();
    expect(await queue.settle("s", delivered([]))).toBe("missing");
  });

  it("settle leaves a record under someone else's current lease untouched, and sets or drops its lease and mark", async () => {
    const queue = freshQueue();
    await queue.save("s", [frame(0), frame(1), frame(2)], [], { lease: lease("recording:tab-1", 1000) });
    const settle = (nowMs: number, extra: Partial<SettleRequest> = {}) =>
      queue.settle("s", {
        deliveredFrames: [frameKey(frame(0))],
        deliveredEvents: [],
        owner: "delivery:tab-2",
        nowMs,
        ...extra,
      });

    expect(await settle(500)).toBe("taken");
    expect((await queue.read("s"))?.frames).toHaveLength(3);

    // The recording's tab went away and its lease ran out.
    expect(await settle(1000, { lease: lease("delivery:tab-2", 9000, "delivery") })).toBe("saved");
    expect(await queue.read("s")).toMatchObject({ frames: [frame(1), frame(2)], lease: { owner: "delivery:tab-2" } });

    const mark = { code: "22023", message: "bad row", atMs: 5, pageLoadId: "page-1", signInId: null };
    expect(await settle(1100, { deliveredFrames: [], lease: null, rejected: mark })).toBe("saved");
    const marked = await queue.read("s");
    expect(marked?.lease).toBeUndefined();
    expect(marked?.rejected).toEqual(mark);

    expect(await settle(1200, { deliveredFrames: [], rejected: null })).toBe("saved");
    expect((await queue.read("s"))?.rejected).toBeUndefined();
  });

  it("claim takes a record only while nobody else's lease is current, and stampLease stamps an existing record only", async () => {
    const queue = freshQueue();
    const delivery = lease("delivery:tab-2", 5000, "delivery");
    expect(await queue.claim("s", delivery, 0)).toEqual({ status: "missing" });

    await queue.save("s", [frame(0)], [], { ownerId: "user-1" });
    await queue.stampLease("s", lease("recording:tab-1", 1000));
    expect((await queue.read("s"))?.lease).toEqual(lease("recording:tab-1", 1000));

    expect(await queue.claim("s", delivery, 999)).toEqual({ status: "held" });
    expect(await queue.claim("s", delivery, 1000)).toMatchObject({ status: "claimed", record: { lease: delivery } });
    expect((await queue.read("s"))?.lease).toEqual(delivery);
    expect(await queue.claim("s", delivery, 1100)).toMatchObject({ status: "claimed" }); // its own lease

    await queue.stampLease("s", null);
    expect((await queue.read("s"))?.lease).toBeUndefined();
    await queue.stampLease("absent", lease("recording:tab-1", 1000));
    expect(await queue.read("absent")).toBeNull();
  });

  it("read, listSessionIds, settle and claim reject when IndexedDB is unavailable, while load still answers null", async () => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      const queue = freshQueue();
      await expect(queue.read("session-a")).rejects.toThrow("IndexedDB unavailable");
      await expect(queue.listSessionIds()).rejects.toThrow("IndexedDB unavailable");
      await expect(
        queue.settle("session-a", { deliveredFrames: [], deliveredEvents: [], owner: null, nowMs: 0 }),
      ).rejects.toThrow("IndexedDB unavailable");
      await expect(queue.claim("session-a", lease("delivery:tab", 1, "delivery"))).rejects.toThrow(
        "IndexedDB unavailable",
      );
      expect(await queue.load("session-a")).toBeNull();
      await queue.stampLease("session-a", null); // best-effort, does not throw
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
