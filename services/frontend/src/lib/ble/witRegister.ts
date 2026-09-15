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
 */

export const WIT_WRITE_CHARACTERISTIC_UUID = "0000ffe9-0000-1000-8000-00805f9a34fb";

/** RRATE, the return-rate register. Reading it back returns the active rate code in `values[0]`. */
export const WIT_RATE_REGISTER = 0x03;

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

function byte(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new RangeError(`Not a byte: ${value}`);
  return value;
}
