"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BufferCounters } from "@/lib/telemetry/buffer";

import type { SensorRole } from "./roles";
import { BleSessionRecorder, ZERO_COUNTERS } from "./sessionRecorder";
import type { SignalQualityReport } from "./signalQuality";
import type { ParsedWt901Frame } from "./wt901ble68";

export interface UseBleSessionRecorderResult {
  /** Delivery counters, updated a few times a second while frames stream in and after every flush. */
  counters: BufferCounters;
  /** Start recording into `sessionId`. Call once the session row exists. */
  start: (sessionId: string) => Promise<void>;
  /** Stop and await the final drain -- no trailing frames lost. Resolves with the final counters. */
  stop: () => Promise<BufferCounters | null>;
  /** Feed one frame with its browser receive time (epoch ms), e.g. straight from `subscribeFrames`. */
  recordFrame: (role: SensorRole, frame: ParsedWt901Frame, receivedAtMs: number) => void;
  /** The latest signal-quality evaluation (at most once a second), or null before the first frame. */
  lastQuality: () => SignalQualityReport | null;
  /** Frames handed to the buffer since start. */
  framesRecorded: () => number;
}

/**
 * React handle on `BleSessionRecorder` (see that file for what a recorded row
 * holds). The recorder lives for the component's lifetime; unmounting stops it,
 * which still drains what is queued, so leaving the screen without calling
 * `stop()` does not strand frames in memory.
 */
export function useBleSessionRecorder(): UseBleSessionRecorderResult {
  const [counters, setCounters] = useState<BufferCounters>(ZERO_COUNTERS);
  const recorderRef = useRef<BleSessionRecorder | null>(null);
  if (!recorderRef.current) recorderRef.current = new BleSessionRecorder({ onCounters: setCounters });
  const recorder = recorderRef.current;

  useEffect(
    () => () => {
      void recorder.stop();
    },
    [recorder],
  );

  const start = useCallback((sessionId: string) => recorder.start(sessionId), [recorder]);
  const stop = useCallback(() => recorder.stop(), [recorder]);
  const recordFrame = useCallback(
    (role: SensorRole, frame: ParsedWt901Frame, receivedAtMs: number) => recorder.recordFrame(role, frame, receivedAtMs),
    [recorder],
  );
  const lastQuality = useCallback(() => recorder.lastQuality, [recorder]);
  const framesRecorded = useCallback(() => recorder.framesRecorded, [recorder]);

  return { counters, start, stop, recordFrame, lastQuality, framesRecorded };
}
