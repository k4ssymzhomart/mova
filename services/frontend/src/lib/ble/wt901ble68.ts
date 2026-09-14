/**
 * Ported verbatim from Phoenix's `packages/ui/src/ble/wt901ble68.ts` (do not
 * reimplement independently -- port test vectors instead, same as that file's
 * own header instructs). Same 20-byte `0x55 0x61` frame shape (accel/gyro/euler,
 * no checksum), same scale factors.
 *
 * Confirmed against real WT901BLE68 hardware by the Phoenix project on
 * 2026-09-05/06: service `0000ffe5-0000-1000-8000-00805f9a34fb`, notify
 * characteristic `0000ffe4-0000-1000-8000-00805f9a34fb` -- note the
 * non-standard `9a` base UUID, not the Bluetooth SIG-standard `9b`.
 */

export const WT901BLE68_SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb";
export const WT901BLE68_CHARACTERISTIC_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb";

const FRAME_HEADER: readonly [number, number] = [0x55, 0x61];
const FRAME_LENGTH = 20;

export interface ParsedWt901Frame {
  accelerometerRaw: [number, number, number];
  gyroscopeRaw: [number, number, number];
  eulerDegrees: [number, number, number];
}

export class FrameParseError extends Error {}

/** Extracts complete frames from arbitrary BLE notification chunks, resynchronising on noise. */
export class WitMotion61FrameBuffer {
  private buffer: number[] = [];

  feed(chunk: Uint8Array): Uint8Array[] {
    for (const byte of chunk) this.buffer.push(byte);
    const frames: Uint8Array[] = [];
    for (;;) {
      const headerIndex = this.findHeader();
      if (headerIndex < 0) {
        // Retain a possible first header byte for the next notification.
        this.buffer = this.buffer[this.buffer.length - 1] === FRAME_HEADER[0] ? [FRAME_HEADER[0]] : [];
        return frames;
      }
      if (headerIndex > 0) this.buffer.splice(0, headerIndex);
      if (this.buffer.length < FRAME_LENGTH) return frames;
      frames.push(Uint8Array.from(this.buffer.slice(0, FRAME_LENGTH)));
      this.buffer.splice(0, FRAME_LENGTH);
    }
  }

  private findHeader(): number {
    for (let i = 0; i <= this.buffer.length - 2; i += 1) {
      if (this.buffer[i] === FRAME_HEADER[0] && this.buffer[i + 1] === FRAME_HEADER[1]) return i;
    }
    return -1;
  }
}

/**
 * Parses one 20-byte frame. Deliberately does not (and cannot honestly)
 * verify a checksum -- this observed frame shape carries none. Callers must
 * mark resulting packets `validation_status: "unverified_checksum"`.
 */
export function parseWt901Frame(frame: Uint8Array): ParsedWt901Frame {
  if (frame.length !== FRAME_LENGTH || frame[0] !== FRAME_HEADER[0] || frame[1] !== FRAME_HEADER[1]) {
    throw new FrameParseError("Expected a 20-byte 0x55 0x61 frame");
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const values: number[] = [];
  for (let i = 0; i < 9; i += 1) {
    values.push(view.getInt16(2 + i * 2, true));
  }
  return {
    accelerometerRaw: [values[0], values[1], values[2]],
    gyroscopeRaw: [values[3], values[4], values[5]],
    eulerDegrees: [
      (values[6] / 32768) * 180,
      (values[7] / 32768) * 180,
      (values[8] / 32768) * 180,
    ],
  };
}
