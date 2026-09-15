"use client";

import { useEffect, useState } from "react";

import { drainTelemetryOutbox } from "./outbox";
import { subscribeOutbox } from "./outboxRegistry";
import { startOutboxScheduler } from "./outboxScheduler";

export interface UseTelemetryOutboxResult {
  /**
   * Rows still stored on this device waiting to reach the server, after the latest run. Null before the first run
   * finishes and when IndexedDB cannot be read, so the count is unknown rather than zero.
   */
  remaining: number | null;
}

/**
 * Keeps the telemetry outbox (outbox.ts) moving while the component is mounted: a drain on mount, on the window
 * "online" event, when a recording stops with rows left, and every 30 s while rows remain.
 */
export function useTelemetryOutbox(): UseTelemetryOutboxResult {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(
    () =>
      startOutboxScheduler({
        drain: drainTelemetryOutbox,
        onRemaining: setRemaining,
        online: window,
        subscribe: subscribeOutbox,
      }),
    [],
  );

  return { remaining };
}
