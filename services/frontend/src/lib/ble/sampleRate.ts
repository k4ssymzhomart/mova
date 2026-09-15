/**
 * STUB -- the sample-rate write path, pending the sibling sampling-rate
 * issue's bench-validated register protocol.
 *
 * Phoenix has no code for this at all: it only ever records whatever rate
 * the firmware happens to be broadcasting at (see
 * `docs/imu/current-script-audit.md` in the Phoenix repo), it never writes
 * to a rate-configuration characteristic. WitMotion's commonly documented
 * register-write protocol (0xFF 0xAA prefix + register address + value,
 * register 0x03 = RRATE) is for their serial/UART line and is not confirmed
 * to apply unmodified over this device's BLE GATT surface -- the 20-byte
 * frame shape in `wt901ble68.ts` was itself a live-hardware correction of an
 * earlier, wrong protocol assumption, so the same caution applies here:
 * do not fill in a guessed byte sequence without hardware confirmation from
 * that issue. Writing a wrong register value to a real sensor is not a safe
 * guess to make blind.
 *
 * The call site is wired up now (this stays exported and used by the
 * connect flow) so that landing the bench-validated protocol later is a
 * body-only change here, not a new call-site hunt.
 */

/** Characteristic hosting the (unconfirmed) sample-rate register. Same base service as notify/ffe4 -- unverified. */
export const SAMPLE_RATE_CHARACTERISTIC_UUID = "0000ffe9-0000-1000-8000-00805f9a34fb";

/** NTZ IMU-02 recommends 50-100 Hz; exact target is pending the sampling-rate issue's bench test. */
export const PENDING_SAMPLE_RATE_HZ = 50;

export class SampleRateNotConfirmedError extends Error {}

/**
 * Writes the desired sample rate to `ffe9` and reads back a confirmation.
 * Throws until the sampling-rate issue lands a bench-validated protocol --
 * see the module doc above for why this isn't filled in speculatively.
 */
export async function setSampleRate(
  _service: BluetoothRemoteGATTService,
  hz: number = PENDING_SAMPLE_RATE_HZ
): Promise<number> {
  throw new SampleRateNotConfirmedError(
    `setSampleRate(${hz}) is stubbed pending the sampling-rate issue's bench-validated WitMotion register protocol for ${SAMPLE_RATE_CHARACTERISTIC_UUID} -- see docs/imu/ble-connectivity.md`
  );
}
