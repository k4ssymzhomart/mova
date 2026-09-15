import { describe, expect, it } from "vitest";

import {
  RATE_CODE_BY_HZ,
  RegisterReplyParseError,
  WIT_BATTERY_REGISTER,
  WitRegisterReplyBuffer,
  batteryVoltsFromRaw,
  parseRegisterReply,
  readRegisterCommand,
  setReturnRateCommand,
  unlockCommand,
  vendorBatteryPercent,
} from "./witRegister";
import { WitMotion61FrameBuffer, parseWt901Frame } from "./wt901ble68";

/** Real 55 61 frame from Phoenix's 2026-09-05 live capture (same vector as wt901ble68.test.ts). */
const CAPTURED_DATA_FRAME = Uint8Array.from([
  0x55, 0x61, 0xc1, 0xfc, 0xf0, 0xfe, 0x1a, 0x06, 0xbc, 0x02, 0x87, 0x00, 0xa7, 0x00, 0xe3, 0x06, 0x9f, 0x03, 0x2b,
  0x6f,
]);

/** Register 0x03 answering with rate code 0x08, trailing bytes zero. */
const RATE_REPLY = Uint8Array.from([
  0x55, 0x71, 0x03, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00,
]);

describe("command builders", () => {
  it("builds the SDK unlock command", () => {
    expect([...unlockCommand()]).toEqual([0xff, 0xaa, 0x69, 0x88, 0xb5]);
  });

  it("builds set-return-rate for the two agreed codes", () => {
    expect(RATE_CODE_BY_HZ[50]).toBe(0x08);
    expect(RATE_CODE_BY_HZ[100]).toBe(0x09);
    expect([...setReturnRateCommand(RATE_CODE_BY_HZ[50])]).toEqual([0xff, 0xaa, 0x03, 0x08, 0x00]);
    expect([...setReturnRateCommand(RATE_CODE_BY_HZ[100])]).toEqual([0xff, 0xaa, 0x03, 0x09, 0x00]);
  });

  it("builds read-register", () => {
    expect([...readRegisterCommand(0x03)]).toEqual([0xff, 0xaa, 0x27, 0x03, 0x00]);
  });

  it("refuses values that are not a byte", () => {
    expect(() => setReturnRateCommand(256)).toThrow(RangeError);
    expect(() => readRegisterCommand(-1)).toThrow(RangeError);
  });
});

describe("parseRegisterReply", () => {
  it("reads the register and four little-endian int16 values", () => {
    expect(parseRegisterReply(RATE_REPLY)).toEqual({ register: 0x03, values: [8, 0, 0, 0] });
  });

  it("decodes signed values and a two-byte register address", () => {
    const frame = new Uint8Array(20);
    frame.set([0x55, 0x71, 0x34, 0x01, 0xff, 0xff, 0x00, 0x80, 0xff, 0x7f, 0x02, 0x00]);
    expect(parseRegisterReply(frame)).toEqual({ register: 0x0134, values: [-1, -32768, 32767, 2] });
  });

  it("rejects a data frame or a short frame", () => {
    expect(() => parseRegisterReply(CAPTURED_DATA_FRAME)).toThrow(RegisterReplyParseError);
    expect(() => parseRegisterReply(RATE_REPLY.slice(0, 19))).toThrow(RegisterReplyParseError);
  });
});

describe("WitRegisterReplyBuffer", () => {
  it("separates a reply from data frames delivered in one chunk, alongside the verbatim data buffer", () => {
    const chunk = new Uint8Array([...CAPTURED_DATA_FRAME, ...RATE_REPLY, ...CAPTURED_DATA_FRAME]);

    const replies = new WitRegisterReplyBuffer().feed(chunk);
    const frames = new WitMotion61FrameBuffer().feed(chunk);

    expect(replies).toHaveLength(1);
    expect(parseRegisterReply(replies[0])).toEqual({ register: 0x03, values: [8, 0, 0, 0] });
    // The data buffer still sees exactly the two data frames and drops the reply as noise.
    expect(frames).toHaveLength(2);
    expect(parseWt901Frame(frames[0]).accelerometerRaw).toEqual([-831, -272, 1562]);
    expect(parseWt901Frame(frames[1]).accelerometerRaw).toEqual([-831, -272, 1562]);
  });

  it("assembles a reply split across notifications after leading noise", () => {
    const buffer = new WitRegisterReplyBuffer();
    expect(buffer.feed(Uint8Array.from([0x01, 0x02, 0x55]))).toHaveLength(0);
    expect(buffer.feed(RATE_REPLY.slice(1, 7))).toHaveLength(0);
    const replies = buffer.feed(RATE_REPLY.slice(7));
    expect(replies).toHaveLength(1);
    expect(replies[0]).toEqual(RATE_REPLY);
  });

  it("does not mistake a 55 71 byte pair inside a data frame's payload for a reply", () => {
    const frame = CAPTURED_DATA_FRAME.slice();
    new DataView(frame.buffer).setInt16(8, 0x7155, true); // gyro x bytes become 55 71
    expect([frame[8], frame[9]]).toEqual([0x55, 0x71]);

    const buffer = new WitRegisterReplyBuffer();
    expect(buffer.feed(frame)).toHaveLength(0);
    expect(buffer.feed(RATE_REPLY)).toHaveLength(1);
  });
});

describe("battery register", () => {
  it("reads 0x64 and converts the reply's first value from volts x 100", () => {
    expect([...readRegisterCommand(WIT_BATTERY_REGISTER)]).toEqual([0xff, 0xaa, 0x27, 0x64, 0x00]);
    const frame = new Uint8Array(20);
    frame.set([0x55, 0x71, 0x64, 0x00, 0x88, 0x01]);
    const reply = parseRegisterReply(frame);
    expect(reply).toEqual({ register: WIT_BATTERY_REGISTER, values: [392, 0, 0, 0] });
    expect(batteryVoltsFromRaw(reply.values[0])).toBe(3.92);
  });

  it("refuses values that cannot be a supply voltage instead of clamping them", () => {
    expect(batteryVoltsFromRaw(0)).toBeNull();
    expect(batteryVoltsFromRaw(-12)).toBeNull();
    expect(batteryVoltsFromRaw(1001)).toBeNull();
    expect(batteryVoltsFromRaw(3.5)).toBeNull();
    expect(batteryVoltsFromRaw(1000)).toBe(10);
  });
});

describe("vendorBatteryPercent", () => {
  it("interpolates the single-cell table linearly and clamps outside it", () => {
    expect(vendorBatteryPercent(3.1)).toBe(0);
    expect(vendorBatteryPercent(3.4)).toBe(0);
    expect(vendorBatteryPercent(3.7)).toBe(15);
    expect(vendorBatteryPercent(3.8)).toBe(43.3);
    expect(vendorBatteryPercent(3.92)).toBe(72.5);
    expect(vendorBatteryPercent(3.99)).toBe(100);
    expect(vendorBatteryPercent(4.2)).toBe(100);
    // Exactly 5.5 V is not above the two-cell threshold.
    expect(vendorBatteryPercent(5.5)).toBe(100);
  });

  it("switches to the two-cell table above 5.5 V", () => {
    expect(vendorBatteryPercent(5.51)).toBe(0);
    expect(vendorBatteryPercent(6.8)).toBe(10);
    expect(vendorBatteryPercent(7.0)).toBe(17.3);
    expect(vendorBatteryPercent(8.1)).toBe(74);
    expect(vendorBatteryPercent(8.8)).toBe(100);
    expect(vendorBatteryPercent(9.2)).toBe(100);
  });
});
