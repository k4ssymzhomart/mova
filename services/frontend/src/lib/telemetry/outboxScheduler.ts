// When the telemetry outbox runs: once at start, whenever the browser comes back online, whenever a buffer stops
// with rows left (outboxRegistry), and every 30 s while rows remain. Kept free of React so it can be tested
// without a DOM; useTelemetryOutbox wires it to a component.

import type { OutboxDrainResult } from "./outbox";

export const OUTBOX_POLL_MS = 30_000;

export interface OutboxSchedulerOptions {
  drain: () => Promise<OutboxDrainResult>;
  /** Rows still waiting after each run, or null when the run failed (IndexedDB could not be read). */
  onRemaining: (remaining: number | null) => void;
  /** Where the "online" event arrives: `window` in the browser. */
  online?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
  /** Called with a listener to run when stored rows change hands; returns an unsubscribe function. */
  subscribe?: (listener: () => void) => () => void;
  pollMs?: number;
}

/** Starts scheduling and returns the function that stops it. */
export function startOutboxScheduler({
  drain,
  onRemaining,
  online = null,
  subscribe,
  pollMs = OUTBOX_POLL_MS,
}: OutboxSchedulerOptions): () => void {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearPoll = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // Triggers that arrive during a run join it (drain shares one run), and each answer re-arms a single poll.
  const run = () => {
    if (disposed) return;
    clearPoll();
    drain().then(
      (result) => {
        if (disposed) return;
        onRemaining(result.remaining);
        clearPoll();
        if (result.remaining > 0) timer = setTimeout(run, pollMs);
      },
      () => {
        if (disposed) return;
        onRemaining(null);
        clearPoll();
      },
    );
  };

  online?.addEventListener("online", run);
  const unsubscribe = subscribe?.(run);
  run();

  return () => {
    disposed = true;
    clearPoll();
    online?.removeEventListener("online", run);
    unsubscribe?.();
  };
}
