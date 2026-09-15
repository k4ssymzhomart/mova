import { describe, expect, it } from "vitest";
import { FrameParseError, WitMotion61FrameBuffer, parseWt901Frame } from "./wt901ble68";

/**
 * Ported verbatim from Phoenix's `packages/ui/src/ble/wt901ble68.test.ts` --
 * same test vectors, including the 2026-09-05 real-hardware capture, so both
 * ports stay verified against the same observed frame shape.
 */
function makeObservedShapeFrame(options: {
  accelerometer: [number, number, number];
  gyroscope: [number, number, number];
  eulerDegrees: [number, number, number];
}): Uint8Array {
  const int16Angle = (degrees: number) => Math.round((Math.max(-180, Math.min(180, degrees)) / 180) * 32768);
  const frame = new Uint8Array(20);
  frame[0] = 0x55;
  frame[1] = 0x61;
  const view = new DataView(frame.buffer);
  const values = [
    ...options.accelerometer,
    ...options.gyroscope,
    ...options.eulerDegrees.map(int16Angle),
  ];
  values.forEach((value, index) => view.setInt16(2 + index * 2, value, true));
  return frame;
}

describe("parseWt901Frame", () => {
  it("parses the observed frame shape without discarding raw values", () => {
    const frame = makeObservedShapeFrame({
      accelerometer: [1, -2, 3],
      gyroscope: [-4, 5, -6],
      eulerDegrees: [90, -45, 0],
    });

    const parsed = parseWt901Frame(frame);

    expect(parsed.accelerometerRaw).toEqual([1, -2, 3]);
    expect(parsed.gyroscopeRaw).toEqual([-4, 5, -6]);
    expect(parsed.eulerDegrees[0]).toBeCloseTo(90);
    expect(parsed.eulerDegrees[1]).toBeCloseTo(-45);
    expect(parsed.eulerDegrees[2]).toBeCloseTo(0);
  });

  it("rejects a bad length or header", () => {
    const frame = makeObservedShapeFrame({
      accelerometer: [1, 2, 3],
      gyroscope: [4, 5, 6],
      eulerDegrees: [0, 0, 0],
    });

    expect(() => parseWt901Frame(frame.slice(0, -1))).toThrow(FrameParseError);
    const badHeader = frame.slice();
    badHeader[0] = 0x00;
    expect(() => parseWt901Frame(badHeader)).toThrow(FrameParseError);
  });

  it("decodes a real captured hardware frame (from Phoenix's 2026-09-05 live 3-sensor test)", () => {
    // 55 61 c1 fc f0 fe 1a 06 bc 02 87 00 a7 00 e3 06 9f 03 2b 6f
    const frame = Uint8Array.from([
      0x55, 0x61, 0xc1, 0xfc, 0xf0, 0xfe, 0x1a, 0x06, 0xbc, 0x02, 0x87, 0x00, 0xa7, 0x00, 0xe3,
      0x06, 0x9f, 0x03, 0x2b, 0x6f,
    ]);

    const parsed = parseWt901Frame(frame);

    expect(parsed.accelerometerRaw).toEqual([-831, -272, 1562]);
    expect(parsed.gyroscopeRaw).toEqual([700, 135, 167]);
  });
});

describe("WitMotion61FrameBuffer", () => {
  it("accepts fragmented frames and discards noise before the header", () => {
    const frame = makeObservedShapeFrame({
      accelerometer: [1, 2, 3],
      gyroscope: [4, 5, 6],
      eulerDegrees: [0, 0, 0],
    });
    const buffer = new WitMotion61FrameBuffer();

    expect(buffer.feed(new TextEncoder().encode("noise\x55"))).toHaveLength(0);
    expect(buffer.feed(frame.slice(1, 9))).toHaveLength(0);
    const result = buffer.feed(frame.slice(9));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(frame);
  });

  it("parses multiple frames delivered in one notification", () => {
    const frameA = makeObservedShapeFrame({ accelerometer: [1, 0, 0], gyroscope: [0, 0, 0], eulerDegrees: [0, 0, 0] });
    const frameB = makeObservedShapeFrame({ accelerometer: [2, 0, 0], gyroscope: [0, 0, 0], eulerDegrees: [0, 0, 0] });
    const combined = new Uint8Array([...frameA, ...frameB]);
    const buffer = new WitMotion61FrameBuffer();

    const frames = buffer.feed(combined);

    expect(frames).toHaveLength(2);
    expect(parseWt901Frame(frames[0]).accelerometerRaw[0]).toBe(1);
    expect(parseWt901Frame(frames[1]).accelerometerRaw[0]).toBe(2);
  });
});
