"use client";

// DevicesClient — the hardware hub. Two halves:
//  · Camera     — a LIVE permission check (Permissions API + getUserMedia probe) with an enable action.
//  · Wearables  — real Web Bluetooth pairing of the three WT901BLE68 IMUs (thigh/shank/foot), persisted
//    to patient_ble_devices so the binding survives reloads and is visible to clinicians. Chrome/Edge on
//    desktop or Android only for this pilot -- no Web Bluetooth on Safari/iOS.
// Editorial Spatial, lucide icons, no gradients, no charts.

import { Bluetooth, BluetoothOff, Camera, CameraOff, Check, Cpu, Loader2, Radio, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

import { SENSOR_ROLE_LABEL, SENSOR_ROLE_ORDER, type SensorRole, type Side } from "@/lib/ble/roles";
import { type SensorUiStatus, useSensorConnect } from "@/lib/ble/useSensorConnect";
import { cn } from "@/lib/utils";

type CamState = "checking" | "granted" | "denied" | "prompt" | "unsupported";

export default function DevicesClient({
  patientId,
  affectedSide,
  pairedDeviceNames,
}: {
  patientId: string | null;
  affectedSide: Side | null;
  pairedDeviceNames: Partial<Record<SensorRole, string | null>>;
}) {
  return (
    <div className="space-y-8">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Devices</div>
        <h1 className="mt-2 text-4xl leading-none text-ink sm:text-5xl">Your sensors.</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
          Mova works camera-only, and gets sharper when you pair wearable IMUs. Manage both here.
        </p>
      </header>

      <CameraPanel />
      <WearablesPanel patientId={patientId} affectedSide={affectedSide} pairedDeviceNames={pairedDeviceNames} />
    </div>
  );
}

// ---- Camera ----------------------------------------------------------------

function CameraPanel() {
  const [state, setState] = useState<CamState>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setState("unsupported");
      return;
    }
    if (!navigator.permissions?.query) {
      setState("prompt");
      return;
    }
    navigator.permissions
      // camera isn't in the TS PermissionName union in all libs
      .query({ name: "camera" as PermissionName })
      .then((s) => {
        setState(s.state as CamState);
        s.onchange = () => setState(s.state as CamState);
      })
      .catch(() => setState("prompt"));
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop()); // probe only — release immediately
      setState("granted");
    } catch {
      setState("denied");
    } finally {
      setBusy(false);
    }
  }

  const meta: Record<CamState, { label: string; tone: string; dot: string }> = {
    checking: { label: "Checking…", tone: "text-ink-faint", dot: "bg-ink-faint" },
    granted: { label: "Connected", tone: "text-signal-deep", dot: "bg-signal" },
    denied: { label: "Blocked", tone: "text-destructive", dot: "bg-destructive" },
    prompt: { label: "Not enabled", tone: "text-amber-600", dot: "bg-amber-500" },
    unsupported: { label: "Unavailable", tone: "text-ink-faint", dot: "bg-ink-faint" },
  };
  const m = meta[state];
  const Ico = state === "granted" ? Camera : CameraOff;

  return (
    <section className="rounded-xl border border-line bg-card p-7">
      <div className="flex flex-wrap items-center gap-4">
        <span
          className={cn(
            "grid size-14 shrink-0 place-items-center rounded-lg ring-1",
            state === "granted" ? "bg-signal/10 text-signal-deep ring-signal/25" : "bg-paper-soft text-ink-soft ring-line",
          )}
        >
          <Ico className="size-6" strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl text-ink">Web camera</h2>
            <span className={cn("inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em]", m.tone)}>
              <span className={cn("size-1.5 rounded-full", m.dot)} />
              {m.label}
            </span>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
            The camera powers on-device pose tracking. Frames never leave your device — only derived motion is kept.
          </p>
        </div>
        {state !== "granted" && state !== "unsupported" && (
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-pill bg-night px-5 py-2.5 text-sm font-medium text-paper-soft transition-colors hover:bg-ink disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : <Camera className="size-4" strokeWidth={1.8} />}
            Enable camera
          </button>
        )}
      </div>

      {state === "denied" && (
        <p className="mt-4 rounded-xl bg-paper-soft px-4 py-3 text-[13px] text-ink-soft">
          Camera access is blocked. Allow it in your browser's site settings (the camera icon in the address
          bar), then re-check.
        </p>
      )}
      <div className="mt-4 flex items-center gap-1.5 text-[12px] text-ink-faint">
        <ShieldCheck className="size-3.5 text-signal" strokeWidth={1.8} />
        Privacy-first: raw video is processed locally and discarded.
      </div>
    </section>
  );
}

// ---- Wearables ---------------------------------------------------------------

function WearablesPanel({
  patientId,
  affectedSide,
  pairedDeviceNames,
}: {
  patientId: string | null;
  affectedSide: Side | null;
  pairedDeviceNames: Partial<Record<SensorRole, string | null>>;
}) {
  const [side, setSide] = useState<Side | null>(affectedSide);
  const [receivingData, setReceivingData] = useState<Record<SensorRole, boolean>>({
    thigh: false,
    shank: false,
    foot: false,
  });

  const { statuses, deviceNames, connect, forget, connectedCount, bleSupported } = useSensorConnect(
    patientId,
    side,
    pairedDeviceNames,
    (role) => setReceivingData((s) => (s[role] ? s : { ...s, [role]: true })),
  );

  if (!bleSupported) {
    return (
      <section className="rounded-xl border border-line bg-card p-7">
        <div className="flex items-center gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-paper-soft text-ink-soft ring-1 ring-line">
            <BluetoothOff className="size-5" strokeWidth={1.7} />
          </span>
          <div>
            <h2 className="text-2xl text-ink">Wearable IMUs</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
              Web Bluetooth isn't available in this browser. Pairing real sensors needs Chrome or Edge on
              desktop or Android — Safari and iOS aren't supported for this pilot.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-card p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-paper-soft text-ink-soft ring-1 ring-line">
            <Bluetooth className="size-5" strokeWidth={1.7} />
          </span>
          <div>
            <h2 className="text-2xl text-ink">Wearable IMUs</h2>
            <p className="text-[13px] text-ink-soft">
              {connectedCount > 0
                ? `${connectedCount} of ${SENSOR_ROLE_ORDER.length} paired`
                : "Pair the thigh, shank, and foot sensors in order."}
            </p>
          </div>
        </div>
      </div>

      {!patientId ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-paper-soft/40 px-6 py-8 text-center text-sm text-ink-soft">
          Finish setting up your profile before pairing sensors.
        </p>
      ) : !side ? (
        <SidePicker onPick={setSide} />
      ) : (
        <div className="mt-6 space-y-2.5">
          {SENSOR_ROLE_ORDER.map((role, i) => {
            const prevConnected = i === 0 || statuses[SENSOR_ROLE_ORDER[i - 1]] === "connected";
            return (
              <SensorRow
                key={role}
                role={role}
                status={statuses[role]}
                deviceName={deviceNames[role]}
                receivingData={receivingData[role]}
                disabled={!prevConnected}
                onConnect={() => connect(role)}
                onForget={() => forget(role)}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function SidePicker({ onPick }: { onPick: (side: Side) => void }) {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-line bg-paper-soft/40 px-6 py-8 text-center">
      <p className="mx-auto max-w-sm text-sm text-ink-soft">Which leg are the sensors strapped to for this session?</p>
      <div className="mt-4 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => onPick("left")}
          className="rounded-pill border border-line px-5 py-2.5 text-sm text-ink transition-colors hover:bg-paper-soft"
        >
          Left leg
        </button>
        <button
          type="button"
          onClick={() => onPick("right")}
          className="rounded-pill border border-line px-5 py-2.5 text-sm text-ink transition-colors hover:bg-paper-soft"
        >
          Right leg
        </button>
      </div>
    </div>
  );
}

function SensorRow({
  role,
  status,
  deviceName,
  receivingData,
  disabled,
  onConnect,
  onForget,
}: {
  role: SensorRole;
  status: SensorUiStatus;
  deviceName: string | null | undefined;
  receivingData: boolean;
  disabled: boolean;
  onConnect: () => void;
  onForget: () => void;
}) {
  const connected = status === "connected";
  const busy = status === "requesting" || status === "connecting";

  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-lg border p-4 transition-colors",
        connected ? "border-signal/30 bg-signal/[0.04]" : "border-line bg-card",
        disabled && !connected && "opacity-50",
      )}
    >
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-xl ring-1",
          connected ? "bg-card text-signal-deep ring-signal/25" : "bg-paper-soft text-ink-soft ring-line",
        )}
      >
        <Cpu className="size-5" strokeWidth={1.6} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{SENSOR_ROLE_LABEL[role]}</div>
        <div className="truncate font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
          {deviceName ?? (connected ? "Paired" : status === "error" ? "Connection failed" : "Not paired")}
        </div>
      </div>

      {connected && (
        <span
          className={cn(
            "hidden items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] sm:inline-flex",
            receivingData ? "text-signal-deep" : "text-ink-faint",
          )}
        >
          <Radio className="size-3.5" strokeWidth={1.8} />
          {receivingData ? "Streaming" : "Waiting for data"}
        </span>
      )}

      {connected ? (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-signal/10 px-3 py-2 text-[13px] font-medium text-signal-deep">
            <Check className="size-3.5" strokeWidth={2.2} /> Paired
          </span>
          <button
            type="button"
            onClick={onForget}
            title="Forget this sensor"
            className="grid size-8 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-paper-soft hover:text-destructive"
          >
            <X className="size-4" strokeWidth={1.8} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={disabled || busy}
          className="inline-flex w-28 items-center justify-center gap-1.5 rounded-pill bg-night px-3 py-2 text-[13px] font-medium text-paper-soft transition-colors hover:bg-ink disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" strokeWidth={2} /> : "Connect"}
        </button>
      )}
    </div>
  );
}
