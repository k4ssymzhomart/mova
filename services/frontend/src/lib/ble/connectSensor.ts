/// <reference types="web-bluetooth" />
import { configureSampleRate, TARGET_SAMPLE_RATE_HZ, type SampleRateIo, type SampleRateResult } from "./sampleRate";
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

export interface SensorConnectionHandlers {
  onFrame(frame: ParsedWt901Frame, raw: Uint8Array): void;
  /** "disconnected" fires only when the link drops on its own, not after a local `disconnect()`. */
  onStatusChange?(status: BleConnectionStatus): void;
  onError?(error: unknown): void;
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
  /** Write the rate over `ffe9` and read it back (see `sampleRate.ts`). Calls queue behind each other; never rejects. */
  configureSampleRate(hz?: SupportedRateHz): Promise<SampleRateResult>;
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

/**
 * Connects GATT, subscribes to `ffe4` and takes `ffe9` for register writes.
 *
 * Every raw notification feeds two buffers: the verbatim `WitMotion61FrameBuffer`
 * for data frames and `WitRegisterReplyBuffer` for `55 71` register replies.
 * Writes go through one per-device queue, because Chrome rejects a GATT
 * operation started while another is still in progress on the same device.
 * Listeners and pending reply waits are released on either kind of disconnect.
 */
export async function connectWt901Device(
  device: BluetoothDevice,
  handlers: SensorConnectionHandlers,
): Promise<SensorConnection> {
  handlers.onStatusChange?.("connecting");
  if (!device.gatt) throw new Error("Selected device does not support GATT");

  const frameBuffer = new WitMotion61FrameBuffer();
  const replyBuffer = new WitRegisterReplyBuffer();
  const waiters = new Set<{ register: number; settle: (reply: RegisterReply | null) => void }>();
  let notify: BluetoothRemoteGATTCharacteristic | null = null;
  let writer: BluetoothRemoteGATTCharacteristic | null = null;
  let closed = false;
  let gattQueue: Promise<unknown> = Promise.resolve();
  let rateQueue: Promise<SampleRateResult> | null = null;

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

  function onRemoteDisconnect() {
    if (closed) return;
    release();
    handlers.onStatusChange?.("disconnected");
  }

  const enqueueGatt = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = gattQueue.then(() => {
      if (closed) throw new Error("Sensor is disconnected");
      return operation();
    });
    gattQueue = run.catch(() => undefined);
    return run;
  };

  device.addEventListener("gattserverdisconnected", onRemoteDisconnect);
  try {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(WT901BLE68_SERVICE_UUID);
    notify = await service.getCharacteristic(WT901BLE68_CHARACTERISTIC_UUID);
    // Streaming works without ffe9; only rate configuration needs it, and reports its absence.
    writer = await service.getCharacteristic(WIT_WRITE_CHARACTERISTIC_UUID).catch(() => null);
    notify.addEventListener("characteristicvaluechanged", onValue);
    const characteristic = notify;
    await enqueueGatt(() => characteristic.startNotifications());
  } catch (error) {
    release();
    device.gatt.disconnect();
    throw error;
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
            clearTimeout(timer);
            waiters.delete(waiter);
            resolve(reply);
          },
        };
        const timer = setTimeout(() => waiter.settle(null), timeoutMs);
        waiters.add(waiter);
      }),
  };

  return {
    deviceId: device.id,
    deviceName: device.name ?? null,
    configureSampleRate: (hz = TARGET_SAMPLE_RATE_HZ) => {
      const run = () => configureSampleRate(io, hz);
      rateQueue = rateQueue ? rateQueue.then(run) : run();
      return rateQueue;
    },
    disconnect: () => {
      if (closed) return;
      release();
      device.gatt?.disconnect();
    },
  };
}
