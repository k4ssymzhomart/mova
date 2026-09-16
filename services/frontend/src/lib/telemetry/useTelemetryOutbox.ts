"use client";

import { useEffect, useState } from "react";

import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

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
 * "online" event, when a recording stops with rows left, after a sign-in (so a record refused earlier gets its
 * retry), and every 30 s while rows remain.
 */
export function useTelemetryOutbox(): UseTelemetryOutboxResult {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(
    () =>
      startOutboxScheduler({
        drain: drainTelemetryOutbox,
        onRemaining: setRemaining,
        online: window,
        subscribe: (listener) => {
          const stopRegistry = subscribeOutbox(listener);
          const stopSignIns = subscribeSignIns(listener);
          return () => {
            stopRegistry();
            stopSignIns();
          };
        },
      }),
    [],
  );

  return { remaining };
}

/** Calls `listener` after each sign-in, outside the auth callback, which must not call back into Supabase auth. */
function subscribeSignIns(listener: () => void): () => void {
  if (!isSupabaseConfigured()) return () => undefined;
  try {
    const { data } = createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") setTimeout(listener, 0);
    });
    return () => data.subscription.unsubscribe();
  } catch {
    return () => undefined;
  }
}
