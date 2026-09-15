/// <reference types="web-bluetooth" />
import {
  configureSampleRate,
  readBatteryLevel,
  TARGET_SAMPLE_RATE_HZ,
  type BatteryReadResult,
  type SampleRateIo,
  type SampleRateResult,
} from "./sampleRate";
import {
  WIT_WRITE_CHARACTERISTIC_UUID,
  WitRegisterReplyBuffer,
  parseRegisterReply,
  type RegisterReply,
  type SupportedRateHz,
} from "./witRegister";
import {
  WT901BLE68_CHARACTERISTIC_UUID,
  WT901BLE68_SERVICE_UUID,
  WitMotion61FrameBuffer,
  parseWt901Frame,
  type ParsedWt901Frame,
} from "./wt901ble68";

export type BleConnectionStatus = "requesting" | "connecting" | "connected" | "disconnected" | "error";

/**
 * How long connecting and service discovery may take before the attempt is abandoned. Neither Chrome nor
 * CoreBluetooth on macOS times out a GATT connect on its own, so without this a sensor that dies while it is
 * being picked leaves the attempt pending for good.
 */
export const GATT_CONNECT_TIMEOUT_MS = 15_000;

export interface SensorConnectionHandlers {
  onFrame(frame: ParsedWt901Frame, raw: Uint8Array): void;
  /** "disconnected" fires only when the link drops on its own, not after a local `disconnect()`. */
  onStatusChange?(status: BleConnectionStatus): void;
  onError?(error: unknown): void;
}

export interface ConnectDeviceOptions {
  /** Defaults to GATT_CONNECT_TIMEOUT_MS. */
  timeoutMs?: number;
}

export class SensorConnectTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`GATT connection did not complete within ${Math.round(timeoutMs / 1000)} s`);
    this.name = "TimeoutError";
  }
}

export interface SensorConnection {
  /** Opaque per-origin id from the browser -- not the physical MAC (Web Bluetooth does not expose it). */
  deviceId: string;
  /**
   * Human-readable device name the browser advertised (often the sticker/MAC-like
   * label printed on WitMotion sensors, e.g. "WT901BLE68"). `null` when the
   * platform withholds it. Persisted server-side (see `patient_ble_devices`) so
   * the patient does not have to re-identify which physical sensor belongs to
   * which body location every time.
   */
  deviceName: string | null;
  /** Write the rate over `ffe9` and read it back (see `sampleRate.ts`). Queued with readBattery; never rejects. */
  configureSampleRate(hz?: SupportedRateHz): Promise<SampleRateResult>;
  /** Read the supply voltage from register 0x64. Queued with configureSampleRate; never rejects. */
  readBattery(): Promise<BatteryReadResult>;
  disconnect(): void;
}

/**
 * Requests, connects to, and streams one WT901BLE68 sensor over Web
 * Bluetooth. Must be called from within a user gesture (a click handler) --
 * `requestDevice()` throws otherwise.
 *
 * Requires a secure context: HTTPS, or http://localhost (Chrome's dev
 * exception). It will not work over plain HTTP on any other origin, and not
 * at all on Safari/iOS (no Web Bluetooth support there) -- this pilot is
 * scoped to Chrome/Edge on desktop and Android.
 *
 * Role-agnostic by design, same as the Phoenix client this was ported from:
 * binding a connection to a THIGH/SHANK/FOOT role happens one layer up.
 */
export async function connectWt901Sensor(handlers: SensorConnectionHandlers): Promise<SensorConnection> {
  handlers.onStatusChange?.("requesting");
  const device = await requestWt901Device();
  return connectWt901Device(device, handlers);
}

/**
 * Opens the browser's device chooser filtered to the WitMotion service. Split
 * from connecting so the caller can refuse a device (e.g. one already bound to
 * another role) before any GATT connection is made. Rejects with a
 * `NotFoundError` DOMException when the patient closes the chooser.
 */
export async function requestWt901Device(): Promise<BluetoothDevice> {
  if (!navigator.bluetooth) {
    throw new Error(
      "Web Bluetooth is not available (needs Chrome/Edge over HTTPS or http://localhost, not this browser/origin)"
    );
  }
  return navigator.bluetooth.requestDevice({
    filters: [{ services: [WT901BLE68_SERVICE_UUID] }],
  });
}

// The newest connection made on each device object. A reconnect reuses the same BluetoothDevice, so an older,
// abandoned connection must not call gatt.disconnect() and take the newer link down with it.
const currentConnectionByDevice = new WeakMap<BluetoothDevice, symbol>();

/**
 * Connects GATT, subscribes to `ffe4` and takes `ffe9` for register writes.
 * Calling it again on the same device is how a dropped sensor is reconnected
 * without the chooser: everything below is acquired afresh.
 *
 * Every raw notification feeds two buffers: the verbatim `WitMotion61FrameBuffer`
 * for data frames and `WitRegisterReplyBuffer` for `55 71` register replies.
 * Writes go through one per-device queue, because Chrome rejects a GATT
 * operation started while another is still in progress on the same device, and
 * the rate and battery sequences queue behind each other so their commands never
 * interleave. Connecting and discovery are abandoned after `timeoutMs`; the
 * pending connect is then cancelled with `gatt.disconnect()`. Listeners and
 * pending reply waits are released on either kind of disconnect.
 */
export async function connectWt901Device(
  device: BluetoothDevice,
  handlers: SensorConnectionHandlers,
  { timeoutMs = GATT_CONNECT_TIMEOUT_MS }: ConnectDeviceOptions = {},
): Promise<SensorConnection> {
  handlers.onStatusChange?.("connecting");
  const gatt = device.gatt;
  if (!gatt) throw new Error("Selected device does not support GATT");

  const token = Symbol(device.id);
  currentConnectionByDevice.set(device, token);

  const frameBuffer = new WitMotion61FrameBuffer();
  const replyBuffer = new WitRegisterReplyBuffer();
  const waiters = new Set<{ register: number; settle: (reply: RegisterReply | null) => void }>();
  let notify: BluetoothRemoteGATTCharacteristic | null = null;
  let writer: BluetoothRemoteGATTCharacteristic | null = null;
  let closed = false;
  let gattQueue: Promise<unknown> = Promise.resolve();
  let protocolQueue: Promise<unknown> = Promise.resolve();

  const onValue = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    for (const raw of frameBuffer.feed(bytes)) {
      try {
        handlers.onFrame(parseWt901Frame(raw), raw);
      } catch (error) {
        handlers.onError?.(error);
      }
    }
    for (const raw of replyBuffer.feed(bytes)) {
      const reply = parseRegisterReply(raw);
      for (const waiter of [...waiters]) if (waiter.register === reply.register) waiter.settle(reply);
    }
  };

  const release = () => {
    closed = true;
    notify?.removeEventListener("characteristicvaluechanged", onValue);
    device.removeEventListener("gattserverdisconnected", onRemoteDisconnect);
    for (const waiter of [...waiters]) waiter.settle(null);
  };

  const disconnectGatt = () => {
    if (currentConnectionByDevice.get(device) === token) gatt.disconnect();
  };

  function onRemoteDisconnect() {
    if (closed) return;
    release();
    handlers.onStatusChange?.("disconnected");
  }

  const ensureOpen = () => {
    if (closed) throw new Error("Sensor is disconnected");
  };

  const enqueueGatt = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = gattQueue.then(() => {
      ensureOpen();
      return operation();
    });
    gattQueue = run.catch(() => undefined);
    return run;
  };

  const enqueueProtocol = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = protocolQueue.then(operation);
    protocolQueue = run.catch(() => undefined);
    return run;
  };

  device.addEventListener("gattserverdisconnected", onRemoteDisconnect);

  // Each step checks that the attempt was not abandoned meanwhile (timeout or a drop), so a connect that settles
  // late never attaches listeners to a connection nobody holds.
  const setup = async () => {
    const server = await gatt.connect();
    ensureOpen();
    const service = await server.getPrimaryService(WT901BLE68_SERVICE_UUID);
    ensureOpen();
    const characteristic = await service.getCharacteristic(WT901BLE68_CHARACTERISTIC_UUID);
    ensureOpen();
    // Streaming works without ffe9; only the register sequences need it, and they report its absence.
    writer = await service.getCharacteristic(WIT_WRITE_CHARACTERISTIC_UUID).catch(() => null);
    ensureOpen();
    notify = characteristic;
    characteristic.addEventListener("characteristicvaluechanged", onValue);
    await enqueueGatt(() => characteristic.startNotifications());
    ensureOpen();
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const setupRun = setup();
  setupRun.catch(() => undefined); // a setup that loses the race settles unobserved
  try {
    await Promise.race([
      setupRun,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SensorConnectTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } catch (error) {
    release();
    disconnectGatt();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  handlers.onStatusChange?.("connected");

  const io: SampleRateIo = {
    write: (bytes) =>
      enqueueGatt(async () => {
        if (!writer) throw new Error(`Sensor exposes no ${WIT_WRITE_CHARACTERISTIC_UUID} characteristic`);
        // Prefer write-without-response: the readback, not a link-layer ack, is what confirms the rate.
        if (writer.properties.writeWithoutResponse) await writer.writeValueWithoutResponse(bytes);
        else if (writer.properties.write) await writer.writeValueWithResponse(bytes);
        else throw new Error(`${WIT_WRITE_CHARACTERISTIC_UUID} is not writable`);
      }),
    awaitRegisterReply: (register, timeoutMs) =>
      new Promise<RegisterReply | null>((resolve) => {
        if (closed) {
          resolve(null);
          return;
        }
        const waiter = {
          register,
          settle: (reply: RegisterReply | null) => {
            clearTimeout(waitTimer);
            waiters.delete(waiter);
            resolve(reply);
          },
        };
        const waitTimer = setTimeout(() => waiter.settle(null), timeoutMs);
        waiters.add(waiter);
      }),
  };

  return {
    deviceId: device.id,
    deviceName: device.name ?? null,
    configureSampleRate: (hz = TARGET_SAMPLE_RATE_HZ) => enqueueProtocol(() => configureSampleRate(io, hz)),
    readBattery: () => enqueueProtocol(() => readBatteryLevel(io)),
    disconnect: () => {
      if (closed) return;
      release();
      disconnectGatt();
    },
  };
}
