import { describe, expect, it } from "vitest";

import { COMMAND_SPACING_MS, configureSampleRate, type SampleRateIo } from "./sampleRate";
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
