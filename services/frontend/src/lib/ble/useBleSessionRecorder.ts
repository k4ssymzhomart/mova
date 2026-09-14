"use client";

import { useCallback, useRef, useState } from "react";

import { type BufferCounters, TelemetryBuffer } from "@/lib/telemetry/buffer";

import type { SensorRole } from "./roles";
import { toFrameRow } from "./telemetryFrame";
import type { ParsedWt901Frame } from "./wt901ble68";

const ZERO_COUNTERS: BufferCounters = { framesSent: 0, eventsSent: 0, pending: 0, errors: 0, lastError: null };

export interface UseBleSessionRecorderResult {
  counters: BufferCounters;
  /** Start recording into `sessionId`. Call once per session, before pairing/streaming begins. */
  start: (sessionId: string) => Promise<void>;
  /** Stop the loop and await a final flush -- no trailing frames lost. */
  stop: () => Promise<void>;
  /** Feed one raw BLE sample. Non-blocking; TelemetryBuffer batches it under the hood. */
  recordFrame: (role: SensorRole, frame: ParsedWt901Frame) => void;
}

/**
 * Routes real per-role BLE frames into the existing TelemetryBuffer batching
 * pipeline (100 frames / 2s per network call) instead of Phoenix's
 * one-fetch-per-frame pattern -- at 10-50 Hz x 3 sensors that would be a
 * fetch per sample. TelemetryBuffer itself needs no changes; only what gets
 * pushed into it does.
 *
 * A single session-wide sequence counter (not per-role) is used so that two
 * roles emitting a frame in the same millisecond never collide on
 * `session_frames`'s (session_id, recorded_at, seq) primary key.
 *
 * Intentionally does not resample to a fixed rate, align roles to a shared
 * clock, or convert raw LSB counts to physical units -- see `toFrameRow`.
 * Wiring this into an actual exercise session's UI is left to that (separate)
 * issue.
 */
export function useBleSessionRecorder(): UseBleSessionRecorderResult {
  const bufferRef = useRef<TelemetryBuffer | null>(null);
  const seqRef = useRef(0);
  const [counters, setCounters] = useState<BufferCounters>(ZERO_COUNTERS);

  const start = useCallback(async (sessionId: string) => {
    seqRef.current = 0;
    setCounters(ZERO_COUNTERS);
    const buffer = new TelemetryBuffer(sessionId, setCounters);
    bufferRef.current = buffer;
    await buffer.start();
  }, []);

  const stop = useCallback(async () => {
    const buffer = bufferRef.current;
    bufferRef.current = null;
    await buffer?.stop();
  }, []);

  const recordFrame = useCallback((role: SensorRole, frame: ParsedWt901Frame) => {
    bufferRef.current?.pushFrame(toFrameRow(role, frame, seqRef.current++));
  }, []);

  return { counters, start, stop, recordFrame };
}
