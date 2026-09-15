import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OutboxDrainResult } from "./outbox";
import { OUTBOX_POLL_MS, startOutboxScheduler } from "./outboxScheduler";

const result = (remaining: number): OutboxDrainResult => ({ sessions: 0, sent: 0, remaining, rejected: 0 });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startOutboxScheduler", () => {
  it("drains on start and again when the browser comes back online", async () => {
    const drain = vi.fn(async () => result(0));
    const online = new EventTarget();
    const seen: (number | null)[] = [];
    const stop = startOutboxScheduler({ drain, onRemaining: (n) => seen.push(n), online });
    await vi.advanceTimersByTimeAsync(0);
    expect(drain).toHaveBeenCalledTimes(1);

    online.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(drain).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([0, 0]);

    stop();
    online.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(drain).toHaveBeenCalledTimes(2);
  });

  it("polls every 30 s while rows remain and stops polling once none do", async () => {
    const answers = [12, 5, 0];
    const drain = vi.fn(async () => result(answers.shift() ?? 0));
    const seen: (number | null)[] = [];
    const stop = startOutboxScheduler({ drain, onRemaining: (n) => seen.push(n) });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(OUTBOX_POLL_MS - 1);
    expect(drain).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(drain).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(OUTBOX_POLL_MS);
    expect(drain).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(OUTBOX_POLL_MS * 3);
    expect(drain).toHaveBeenCalledTimes(3);
    expect(seen).toEqual([12, 5, 0]);
    stop();
  });

  it("drains when a recording stops with rows left, and reports unknown when the store cannot be read", async () => {
    let notify: () => void = () => undefined;
    const unsubscribe = vi.fn();
    const drain = vi
      .fn<() => Promise<OutboxDrainResult>>()
      .mockResolvedValueOnce(result(0))
      .mockRejectedValueOnce(new Error("IndexedDB unavailable"));
    const seen: (number | null)[] = [];
    const stop = startOutboxScheduler({
      drain,
      onRemaining: (n) => seen.push(n),
      subscribe: (listener) => {
        notify = listener;
        return unsubscribe;
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    notify();
    await vi.advanceTimersByTimeAsync(OUTBOX_POLL_MS * 2);
    expect(drain).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([0, null]);

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps a single poll armed when several triggers answer", async () => {
    const drain = vi.fn(async () => result(3));
    const online = new EventTarget();
    const stop = startOutboxScheduler({ drain, onRemaining: () => undefined, online });
    online.dispatchEvent(new Event("online"));
    online.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(drain).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(OUTBOX_POLL_MS);
    expect(drain).toHaveBeenCalledTimes(4);
    stop();
  });
});
