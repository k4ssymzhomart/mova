import { describe, expect, it } from "vitest";

import {
  COMMAND_SPACING_MS,
  configureSampleRate,
  readBatteryLevel,
  requestedRateFromParam,
  type SampleRateIo,
} from "./sampleRate";
import type { RegisterReply } from "./witRegister";

type Answer = RegisterReply | null | "throw";

/** Scripted transport: records every write and answers each register read from `answers` in order. */
function fakeIo(answers: Answer[]) {
  const writes: number[][] = [];
  const armed: { register: number; timeoutMs: number }[] = [];
  let pending: Answer | undefined;
  const io: SampleRateIo = {
    async write(bytes) {
      writes.push([...bytes]);
      if (bytes[2] === 0x27) {
        pending = answers.shift();
        if (pending === "throw") throw new Error("GATT Server is disconnected.");
      }
    },
    awaitRegisterReply(register, timeoutMs) {
      armed.push({ register, timeoutMs });
      // Armed before the read is written; settles once the read went out.
      return Promise.resolve().then(() => (pending === "throw" ? null : pending ?? null));
    },
  };
  return { io, writes, armed };
}

const sleeps: number[] = [];
const sleep = async (ms: number) => {
  sleeps.push(ms);
};

const reply = (code: number): RegisterReply => ({ register: 0x03, values: [code, 0, 0, 0] });

describe("configureSampleRate", () => {
  it("unlocks, sets 50 Hz, reads register 0x03 and confirms a matching readback", async () => {
    sleeps.length = 0;
    const { io, writes, armed } = fakeIo([reply(0x08)]);

    const result = await configureSampleRate(io, 50, { sleep, now: () => 1234 });

    expect(writes).toEqual([
      [0xff, 0xaa, 0x69, 0x88, 0xb5],
      [0xff, 0xaa, 0x03, 0x08, 0x00],
      [0xff, 0xaa, 0x27, 0x03, 0x00],
    ]);
    expect(sleeps).toEqual([COMMAND_SPACING_MS, COMMAND_SPACING_MS]);
    expect(armed).toEqual([{ register: 0x03, timeoutMs: 1500 }]);
    expect(result).toEqual({
      requestedHz: 50,
      requestedCode: 0x08,
      readbackCode: 0x08,
      confirmed: true,
      attempts: 1,
      failure: null,
      errorMessage: null,
      finishedAt: 1234,
    });
    // Never the save-to-flash command.
    expect(writes.some((w) => w[2] === 0x00 && w[3] === 0x00)).toBe(false);
  });

  it("retries the whole sequence and reports a mismatch with the last code read back", async () => {
    const { io, writes } = fakeIo([reply(0x06), reply(0x06), reply(0x06)]);

    const result = await configureSampleRate(io, 50, { sleep });

    expect(result.confirmed).toBe(false);
    expect(result.failure).toBe("mismatch");
    expect(result.readbackCode).toBe(0x06);
    expect(result.attempts).toBe(3);
    expect(writes).toHaveLength(9);
  });

  it("confirms on a later attempt after a timeout", async () => {
    const { io } = fakeIo([null, reply(0x09)]);

    const result = await configureSampleRate(io, 100, { sleep });

    expect(result.confirmed).toBe(true);
    expect(result.requestedCode).toBe(0x09);
    expect(result.attempts).toBe(2);
  });

  it("reports no_reply with an unknown readback when the sensor never answers", async () => {
    const { io } = fakeIo([null, null, null]);

    const result = await configureSampleRate(io, 50, { sleep });

    expect(result).toMatchObject({ confirmed: false, failure: "no_reply", readbackCode: null, attempts: 3 });
  });

  it("reports a failed write with its message", async () => {
    const { io } = fakeIo(["throw", "throw", "throw"]);

    const result = await configureSampleRate(io, 50, { sleep });

    expect(result).toMatchObject({ confirmed: false, failure: "write_failed", errorMessage: "GATT Server is disconnected." });
  });
});

const battery = (raw: number): RegisterReply => ({ register: 0x64, values: [raw, 0, 0, 0] });

describe("readBatteryLevel", () => {
  it("reads register 0x64 without unlocking, after the command spacing, and converts the reply", async () => {
    sleeps.length = 0;
    const { io, writes, armed } = fakeIo([battery(392)]);

    const result = await readBatteryLevel(io, { sleep });

    expect(writes).toEqual([[0xff, 0xaa, 0x27, 0x64, 0x00]]);
    expect(armed).toEqual([{ register: 0x64, timeoutMs: 1500 }]);
    expect(sleeps).toEqual([COMMAND_SPACING_MS]);
    expect(result).toEqual({ ok: true, rawValue: 392, volts: 3.92, vendorPercent: 72.5, attempts: 1 });
  });

  it("retries a missing reply, then reports no_reply with no value", async () => {
    const { io, writes } = fakeIo([null, null]);

    const result = await readBatteryLevel(io, { sleep });

    expect(result).toEqual({ ok: false, failure: "no_reply", rawValue: null, errorMessage: null, attempts: 2 });
    expect(writes).toHaveLength(2);
  });

  it("confirms on the second attempt after a lost reply", async () => {
    const { io } = fakeIo([null, battery(371)]);

    expect(await readBatteryLevel(io, { sleep })).toMatchObject({ ok: true, volts: 3.71, attempts: 2 });
  });

  it("reports an implausible value as a failed read, never as a reading", async () => {
    const { io } = fakeIo([battery(0), battery(-3)]);

    const result = await readBatteryLevel(io, { sleep });

    expect(result).toEqual({ ok: false, failure: "implausible_value", rawValue: -3, errorMessage: null, attempts: 2 });
  });

  it("reports a failed write with its message", async () => {
    const { io } = fakeIo(["throw", "throw"]);

    const result = await readBatteryLevel(io, { sleep });

    expect(result).toMatchObject({ ok: false, failure: "write_failed", errorMessage: "GATT Server is disconnected." });
  });
});

describe("requestedRateFromParam", () => {
  it("requests 100 Hz only for rate=100, and 50 Hz for anything else", () => {
    expect(requestedRateFromParam("100")).toBe(100);
    expect(requestedRateFromParam(["100", "50"])).toBe(100);
    expect(requestedRateFromParam("50")).toBe(50);
    expect(requestedRateFromParam(undefined)).toBe(50);
    expect(requestedRateFromParam(null)).toBe(50);
    expect(requestedRateFromParam([])).toBe(50);
    expect(requestedRateFromParam("200")).toBe(50);
    expect(requestedRateFromParam("100.0")).toBe(50);
    expect(requestedRateFromParam("fast")).toBe(50);
  });
});
