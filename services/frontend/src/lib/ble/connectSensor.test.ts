/// <reference types="web-bluetooth" />
import { afterEach, describe, expect, it, vi } from "vitest";

import { GATT_CONNECT_TIMEOUT_MS, connectWt901Device } from "./connectSensor";
import { WIT_WRITE_CHARACTERISTIC_UUID } from "./witRegister";
import { WT901BLE68_CHARACTERISTIC_UUID } from "./wt901ble68";

/** Real 55 61 frame from Phoenix's 2026-09-05 live capture (same vector as wt901ble68.test.ts). */
const DATA_FRAME = [
  0x55, 0x61, 0xc1, 0xfc, 0xf0, 0xfe, 0x1a, 0x06, 0xbc, 0x02, 0x87, 0x00, 0xa7, 0x00, 0xe3, 0x06, 0x9f, 0x03, 0x2b,
  0x6f,
];

function registerReply(register: number, value: number): number[] {
  const frame = new Array<number>(20).fill(0);
  frame.splice(0, 6, 0x55, 0x71, register, 0x00, value & 0xff, (value >> 8) & 0xff);
  return frame;
}

/** A characteristic that records writes and can push notification bytes. */
class FakeCharacteristic extends EventTarget {
  value: DataView | undefined;
  readonly writes: number[][] = [];
  readonly properties = { write: false, writeWithoutResponse: true };
  onWrite: ((bytes: number[]) => void) | null = null;
  readonly startNotifications = vi.fn(async () => this);

  async writeValueWithoutResponse(bytes: Uint8Array): Promise<void> {
    const copy = [...bytes];
    this.writes.push(copy);
    this.onWrite?.(copy);
  }

  push(bytes: number[]): void {
    this.value = new DataView(Uint8Array.from(bytes).buffer);
    this.dispatchEvent(new Event("characteristicvaluechanged"));
  }
}

function fakeDevice({ connect }: { connect?: (server: unknown) => Promise<unknown> } = {}) {
  const notify = new FakeCharacteristic();
  const writer = new FakeCharacteristic();
  const service = {
    getCharacteristic: async (uuid: string) => {
      if (uuid === WT901BLE68_CHARACTERISTIC_UUID) return notify;
      if (uuid === WIT_WRITE_CHARACTERISTIC_UUID) return writer;
      throw new Error(`No characteristic ${uuid}`);
    },
  };
  const server = { getPrimaryService: async () => service };
  const gatt = {
    connect: vi.fn(() => (connect ? connect(server) : Promise.resolve(server))),
    disconnect: vi.fn(),
  };
  const target = Object.assign(new EventTarget(), { id: "q7Xk2P+aZ/9dLw==", name: "WT901BLE68", gatt });
  return { device: target as unknown as BluetoothDevice, gatt, notify, writer };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("connectWt901Device", () => {
  it("abandons a GATT connect that never settles after 15 s, cancels it and rejects", async () => {
    vi.useFakeTimers();
    const fake = fakeDevice({ connect: () => new Promise(() => {}) });

    const outcome = connectWt901Device(fake.device, { onFrame: () => {} }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(GATT_CONNECT_TIMEOUT_MS - 1);
    expect(fake.gatt.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(await outcome).toMatchObject({ name: "TimeoutError" });
    expect(fake.gatt.disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not attach to a connect that settles after it was abandoned", async () => {
    vi.useFakeTimers();
    let settleConnect: () => void = () => {};
    const fake = fakeDevice({
      connect: (server) =>
        new Promise((resolve) => {
          settleConnect = () => resolve(server);
        }),
    });
    const frames: unknown[] = [];

    const outcome = connectWt901Device(fake.device, { onFrame: (frame) => frames.push(frame) }, { timeoutMs: 4000 });
    outcome.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(outcome).rejects.toMatchObject({ name: "TimeoutError" });

    settleConnect();
    await vi.advanceTimersByTimeAsync(0);
    fake.notify.push(DATA_FRAME);

    expect(fake.notify.startNotifications).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
    expect(fake.gatt.disconnect).toHaveBeenCalledTimes(1);
  });

  it("queues the battery read behind the rate sequence and converts its reply", async () => {
    vi.useFakeTimers();
    const fake = fakeDevice();
    fake.writer.onWrite = (bytes) => {
      if (bytes[2] === 0x27) fake.notify.push(registerReply(bytes[3], bytes[3] === 0x03 ? 0x08 : 392));
    };
    const connection = await connectWt901Device(fake.device, { onFrame: () => {} });

    const rate = connection.configureSampleRate(50);
    const battery = connection.readBattery();
    await vi.advanceTimersByTimeAsync(1000);

    await expect(rate).resolves.toMatchObject({ confirmed: true, readbackCode: 0x08 });
    await expect(battery).resolves.toEqual({ ok: true, rawValue: 392, volts: 3.92, vendorPercent: 72.5, attempts: 1 });
    expect(fake.writer.writes).toEqual([
      [0xff, 0xaa, 0x69, 0x88, 0xb5],
      [0xff, 0xaa, 0x03, 0x08, 0x00],
      [0xff, 0xaa, 0x27, 0x03, 0x00],
      [0xff, 0xaa, 0x27, 0x64, 0x00],
    ]);
  });

  it("reports a remote drop once, and nothing after a local disconnect", async () => {
    const fake = fakeDevice();
    const statuses: string[] = [];
    const handlers = { onFrame: () => {}, onStatusChange: (status: string) => statuses.push(status) };

    await connectWt901Device(fake.device, handlers);
    fake.device.dispatchEvent(new Event("gattserverdisconnected"));
    fake.device.dispatchEvent(new Event("gattserverdisconnected"));
    expect(statuses).toEqual(["connecting", "connected", "disconnected"]);

    statuses.length = 0;
    const second = await connectWt901Device(fake.device, handlers);
    second.disconnect();
    fake.device.dispatchEvent(new Event("gattserverdisconnected"));
    expect(statuses).toEqual(["connecting", "connected"]);
  });

  it("reconnects on the same device object with fresh listeners", async () => {
    const fake = fakeDevice();
    const frames: string[] = [];

    await connectWt901Device(fake.device, { onFrame: () => frames.push("first") });
    fake.device.dispatchEvent(new Event("gattserverdisconnected"));
    await connectWt901Device(fake.device, { onFrame: () => frames.push("second") });
    fake.notify.push(DATA_FRAME);

    expect(frames).toEqual(["second"]);
    expect(fake.gatt.connect).toHaveBeenCalledTimes(2);
  });

  it("never lets an older connection on the same device disconnect the newer one", async () => {
    const fake = fakeDevice();

    const first = await connectWt901Device(fake.device, { onFrame: () => {} });
    const second = await connectWt901Device(fake.device, { onFrame: () => {} });
    first.disconnect();
    expect(fake.gatt.disconnect).not.toHaveBeenCalled();

    second.disconnect();
    expect(fake.gatt.disconnect).toHaveBeenCalledTimes(1);
  });
});
