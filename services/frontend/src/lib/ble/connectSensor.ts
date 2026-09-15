/// <reference types="web-bluetooth" />
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
  if (!navigator.bluetooth) {
    throw new Error(
      "Web Bluetooth is not available (needs Chrome/Edge over HTTPS or http://localhost, not this browser/origin)"
    );
  }
  handlers.onStatusChange?.("requesting");
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [WT901BLE68_SERVICE_UUID] }],
  });

  handlers.onStatusChange?.("connecting");
  device.addEventListener("gattserverdisconnected", () => handlers.onStatusChange?.("disconnected"));

  if (!device.gatt) throw new Error("Selected device does not support GATT");
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(WT901BLE68_SERVICE_UUID);
  const characteristic = await service.getCharacteristic(WT901BLE68_CHARACTERISTIC_UUID);

  const frameBuffer = new WitMotion61FrameBuffer();
  characteristic.addEventListener("characteristicvaluechanged", (event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    const value = target.value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    for (const raw of frameBuffer.feed(bytes)) {
      try {
        handlers.onFrame(parseWt901Frame(raw), raw);
      } catch (error) {
        handlers.onError?.(error);
      }
    }
  });

  await characteristic.startNotifications();
  handlers.onStatusChange?.("connected");

  return {
    deviceId: device.id,
    deviceName: device.name ?? null,
    disconnect: () => device.gatt?.disconnect(),
  };
}
