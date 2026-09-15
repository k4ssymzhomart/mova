/**
 * Sample-rate configuration for the WT901BLE68, replacing the stub #25 left
 * here. The byte sequence is the official WitMotion SDK's (see `witRegister.ts`
 * for sources and for why only 50 and 100 Hz are ever requested):
 *
 *   unlock -> 150 ms -> set return rate -> 150 ms -> read register 0x03 -> await the 55 71 reply
 *
 * The 150 ms spacing copies the SDK, which never fires protocol writes back to
 * back. The whole sequence is retried up to three times, because a lost unlock
 * or rate write looks exactly like a lost read.
 *
 * "Confirmed" means only that the sensor reported the requested code back from
 * its rate register. It does not prove the radio then delivers that many frames
 * per second over three concurrent BLE links; the rate actually delivered is
 * measured separately from received frames (see `liveSensors.ts`) and is the
 * figure that counts.
 *
 * Nothing is saved to flash: the rate is set again at the start of every session.
 */

import {
  RATE_CODE_BY_HZ,
  WIT_RATE_REGISTER,
  WIT_WRITE_CHARACTERISTIC_UUID,
  readRegisterCommand,
  setReturnRateCommand,
  unlockCommand,
  type RegisterReply,
  type SupportedRateHz,
} from "./witRegister";

export const SAMPLE_RATE_CHARACTERISTIC_UUID = WIT_WRITE_CHARACTERISTIC_UUID;

export const TARGET_SAMPLE_RATE_HZ: SupportedRateHz = 50;

export const COMMAND_SPACING_MS = 150;
export const REPLY_TIMEOUT_MS = 1500;
export const MAX_RATE_ATTEMPTS = 3;

/** Transport seam: the live connection implements this over GATT, tests over a script. */
export interface SampleRateIo {
  /** Write one command to `ffe9`. Rejects when the write fails (disconnected, GATT error). */
  write(bytes: Uint8Array): Promise<void>;
  /**
   * Resolve with the next `55 71` reply for `register`, or null after `timeoutMs`.
   * Must be armed before the read command is written, so a fast reply is not missed.
   */
  awaitRegisterReply(register: number, timeoutMs: number): Promise<RegisterReply | null>;
}

/**
 * - no_reply: the sensor never answered the register read.
 * - mismatch: it answered with a different rate code than the one written.
 * - write_failed: a GATT write failed (see `errorMessage`).
 */
export type SampleRateFailure = "no_reply" | "mismatch" | "write_failed";

export interface SampleRateResult {
  requestedHz: SupportedRateHz;
  requestedCode: number;
  /** The code the sensor reported from register 0x03 on its last answer; null when it never answered. */
  readbackCode: number | null;
  confirmed: boolean;
  attempts: number;
  failure: SampleRateFailure | null;
  errorMessage: string | null;
  /** Epoch ms when the sequence finished. */
  finishedAt: number;
}

export interface ConfigureSampleRateOptions {
  spacingMs?: number;
  replyTimeoutMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function configureSampleRate(
  io: SampleRateIo,
  hz: SupportedRateHz = TARGET_SAMPLE_RATE_HZ,
  {
    spacingMs = COMMAND_SPACING_MS,
    replyTimeoutMs = REPLY_TIMEOUT_MS,
    maxAttempts = MAX_RATE_ATTEMPTS,
    sleep = defaultSleep,
    now = Date.now,
  }: ConfigureSampleRateOptions = {},
): Promise<SampleRateResult> {
  const requestedCode = RATE_CODE_BY_HZ[hz];
  let readbackCode: number | null = null;
  let failure: SampleRateFailure | null = null;
  let errorMessage: string | null = null;
  let attempts = 0;
  const result = (confirmed: boolean): SampleRateResult => ({
    requestedHz: hz,
    requestedCode,
    readbackCode,
    confirmed,
    attempts,
    failure: confirmed ? null : failure,
    errorMessage: confirmed ? null : errorMessage,
    finishedAt: now(),
  });

  while (attempts < maxAttempts) {
    attempts += 1;
    try {
      await io.write(unlockCommand());
      await sleep(spacingMs);
      await io.write(setReturnRateCommand(requestedCode));
      await sleep(spacingMs);
      const reply = io.awaitRegisterReply(WIT_RATE_REGISTER, replyTimeoutMs);
      await io.write(readRegisterCommand(WIT_RATE_REGISTER));
      const answer = await reply;
      if (!answer) {
        failure = "no_reply";
        continue;
      }
      readbackCode = answer.values[0];
      if (readbackCode === requestedCode) return result(true);
      failure = "mismatch";
    } catch (error) {
      failure = "write_failed";
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }

  return result(false);
}
