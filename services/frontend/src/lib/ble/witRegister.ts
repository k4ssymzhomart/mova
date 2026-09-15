/**
 * WitMotion register protocol for the WT901BLE68, as the official SDK speaks it
 * (github.com/WITMOTION/WitBluetooth_BWT901BLE5_0: `Bwt901ble.java` for the
 * commands, `Bwt901bleResolver.java` for the reply frame, issue #18 for the rate
 * table). Commands are 5 bytes written to the `ffe9` characteristic; register
 * reads are answered on the notify characteristic (`ffe4`) as 20-byte `55 71`
 * frames, interleaved with the `55 61` data stream.
 *
 * Rate codes: only 50 Hz (`0x08`) and 100 Hz (`0x09`) are used, because those
 * are the two codes the SDK's standard table and issue #18 agree on. The sources
 * disagree elsewhere (`0x06` is 10 Hz in the WIT standard table but 20 Hz in #18;
 * 200 Hz is `0x0B` in one and `0x0A` in the other), so no other code is sent
 * until a bench readback settles it.
 *
 * The save-to-flash command (`FF AA 00 00 00`) is deliberately absent: the rate
 * is written at the start of every session, so nothing needs to survive a power
 * cycle and the sensor's flash is never worn.
 *
 * Battery: the SDK reads register `0x64` (`FF AA 27 64 00` -> `55 71 64 00 ...`),
 * whose first value is the supply voltage x 100, and turns volts into a percent
 * with a fixed interpolation table (`Bwt901bleProcessor.getEqPercent`). That
 * percent is the vendor's table, not a measured state of charge, and is labelled
 * as such wherever it is shown.
 */

export const WIT_WRITE_CHARACTERISTIC_UUID = "0000ffe9-0000-1000-8000-00805f9a34fb";

/** RRATE, the return-rate register. Reading it back returns the active rate code in `values[0]`. */
export const WIT_RATE_REGISTER = 0x03;

/** Supply voltage register. `values[0]` is volts x 100. */
export const WIT_BATTERY_REGISTER = 0x64;

export const RATE_CODE_BY_HZ = { 50: 0x08, 100: 0x09 } as const;

export type SupportedRateHz = keyof typeof RATE_CODE_BY_HZ;

const COMMAND_PREFIX = [0xff, 0xaa] as const;
const REPLY_HEADER = 0x71;
const DATA_HEADER = 0x61;
const FRAME_START = 0x55;
const FRAME_LENGTH = 20;

/** SDK `unlockReg`: opens the register map for writing (the sensor re-locks on its own). */
export function unlockCommand(): Uint8Array {
  return Uint8Array.from([...COMMAND_PREFIX, 0x69, 0x88, 0xb5]);
}

/** SDK `setReturnRate`: `FF AA 03 <code> 00`. */
export function setReturnRateCommand(code: number): Uint8Array {
  return Uint8Array.from([...COMMAND_PREFIX, WIT_RATE_REGISTER, byte(code), 0x00]);
}

/** SDK read-register: `FF AA 27 <reg> 00`. The answer arrives as a `55 71` frame on the notify characteristic. */
export function readRegisterCommand(register: number): Uint8Array {
  return Uint8Array.from([...COMMAND_PREFIX, 0x27, byte(register), 0x00]);
}

export interface RegisterReply {
  /** The register the values start at (little-endian uint16 in bytes 2-3). */
  register: number;
  /** The first four signed little-endian int16 values from `register` onwards, the part the SDK documents. */
  values: [number, number, number, number];
}

export class RegisterReplyParseError extends Error {}

export function parseRegisterReply(frame: Uint8Array): RegisterReply {
  if (frame.length !== FRAME_LENGTH || frame[0] !== FRAME_START || frame[1] !== REPLY_HEADER) {
    throw new RegisterReplyParseError("Expected a 20-byte 0x55 0x71 register reply");
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return {
    register: view.getUint16(2, true),
    values: [view.getInt16(4, true), view.getInt16(6, true), view.getInt16(8, true), view.getInt16(10, true)],
  };
}

/**
 * Pulls complete `55 71` replies out of the raw notification bytes. It runs next
 * to `WitMotion61FrameBuffer` (which stays a verbatim port and throws replies
 * away as noise) on the same bytes, and it is frame-aware: a `55 61` data frame
 * is skipped whole, so a `55 71` byte pair inside accel/gyro/euler payload never
 * reads as a phantom reply.
 */
export class WitRegisterReplyBuffer {
  private buffer: number[] = [];

  feed(chunk: Uint8Array): Uint8Array[] {
    for (const value of chunk) this.buffer.push(value);
    const replies: Uint8Array[] = [];
    for (;;) {
      const headerIndex = this.findHeader();
      if (headerIndex < 0) {
        // Keep a lone trailing 0x55: the next notification may complete the header.
        this.buffer = this.buffer[this.buffer.length - 1] === FRAME_START ? [FRAME_START] : [];
        return replies;
      }
      if (headerIndex > 0) this.buffer.splice(0, headerIndex);
      if (this.buffer.length < FRAME_LENGTH) return replies;
      if (this.buffer[1] === REPLY_HEADER) replies.push(Uint8Array.from(this.buffer.slice(0, FRAME_LENGTH)));
      this.buffer.splice(0, FRAME_LENGTH);
    }
  }

  private findHeader(): number {
    for (let i = 0; i <= this.buffer.length - 2; i += 1) {
      if (this.buffer[i] !== FRAME_START) continue;
      const kind = this.buffer[i + 1];
      if (kind === REPLY_HEADER || kind === DATA_HEADER) return i;
    }
    return -1;
  }
}

/**
 * Volts from the raw `0x64` value, or null when the value cannot be a supply voltage (not above zero, or above
 * 10 V, beyond the SDK's two-cell table). An implausible reply is reported as a failed read, never clamped.
 */
export function batteryVoltsFromRaw(raw: number): number | null {
  if (!Number.isInteger(raw) || raw <= 0 || raw > 1000) return null;
  return raw / 100;
}

// Bwt901bleProcessor.getEqPercent: a two-cell pack above 5.5 V, otherwise a single cell.
const ONE_CELL_VOLTS = [3.4, 3.5, 3.68, 3.7, 3.73, 3.77, 3.79, 3.82, 3.87, 3.93, 3.96, 3.99] as const;
const ONE_CELL_PERCENT = [0, 5, 10, 15, 20, 30, 40, 50, 60, 75, 90, 100] as const;
const TWO_CELL_VOLTS = [6.5, 6.8, 7.35, 7.75, 8.5, 8.8] as const;
const TWO_CELL_PERCENT = [0, 10, 30, 60, 90, 100] as const;
const TWO_CELL_ABOVE_VOLTS = 5.5;

/** The WitMotion table's percent for a voltage: linear between points, clamped to 0-100, one decimal. */
export function vendorBatteryPercent(volts: number): number {
  const twoCell = volts > TWO_CELL_ABOVE_VOLTS;
  const xs: readonly number[] = twoCell ? TWO_CELL_VOLTS : ONE_CELL_VOLTS;
  const ys: readonly number[] = twoCell ? TWO_CELL_PERCENT : ONE_CELL_PERCENT;
  if (volts <= xs[0]) return ys[0];
  const last = xs.length - 1;
  if (volts >= xs[last]) return ys[last];
  let i = 0;
  while (volts >= xs[i + 1]) i += 1;
  const percent = ys[i] + ((volts - xs[i]) * (ys[i + 1] - ys[i])) / (xs[i + 1] - xs[i]);
  return Math.round(percent * 10) / 10;
}

function byte(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`Not a byte: ${value}`);
  return value;
}
