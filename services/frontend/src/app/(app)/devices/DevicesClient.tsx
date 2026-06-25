"use client";

// DevicesClient — the hardware hub. Two halves:
//  · Camera   — a LIVE permission check (Permissions API + getUserMedia probe) with an enable action.
//  · Wearables — a WebBluetooth-style pairing flow for IMUs. The scan + telemetry are mocked (our pipeline
//    ingests real DIP-format IMUs; this is the UI that will drive it), shown with battery + signal.
// Editorial Spatial, lucide icons, no gradients, no charts.

import {
  Battery,
  BatteryLow,
  BatteryMedium,
  Bluetooth,
  Camera,
  CameraOff,
  Check,
  Cpu,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type CamState = "checking" | "granted" | "denied" | "prompt" | "unsupported";

interface Sensor {
  id: string;
  name: string;
  site: string;
  battery: number;
  rssi: number; // dBm; closer to 0 = stronger
  connected: boolean;
}

const CATALOG: Omit<Sensor, "connected">[] = [
  { id: "mv-lumbar", name: "Mova IMU · Lumbar", site: "Lower back", battery: 86, rssi: -49 },
  { id: "mv-lshank", name: "Mova IMU · L-Shank", site: "Left shank", battery: 63, rssi: -62 },
  { id: "mv-rshank", name: "Mova IMU · R-Shank", site: "Right shank", battery: 91, rssi: -55 },
];

export default function DevicesClient() {
  return (
    <div className="space-y-8">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Devices</div>
        <h1 className="mt-2 font-serif text-4xl leading-none text-ink sm:text-5xl">Your sensors.</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
          Mova works camera-only, and gets sharper when you pair wearable IMUs. Manage both here.
        </p>
      </header>

      <CameraPanel />
      <WearablesPanel />
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
            <h2 className="font-serif text-2xl text-ink">Web camera</h2>
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

// ---- Wearables -------------------------------------------------------------

function WearablesPanel() {
  const [phase, setPhase] = useState<"idle" | "scanning" | "found">("idle");
  const [sensors, setSensors] = useState<Sensor[]>([]);

  function scan() {
    setPhase("scanning");
    setSensors([]);
    window.setTimeout(() => {
      setSensors(CATALOG.map((c) => ({ ...c, connected: false })));
      setPhase("found");
    }, 1600);
  }

  function toggle(id: string) {
    setSensors((list) => list.map((s) => (s.id === id ? { ...s, connected: !s.connected } : s)));
  }

  const connectedCount = sensors.filter((s) => s.connected).length;

  return (
    <section className="rounded-xl border border-line bg-card p-7">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-paper-soft text-ink-soft ring-1 ring-line">
            <Bluetooth className="size-5" strokeWidth={1.7} />
          </span>
          <div>
            <h2 className="font-serif text-2xl text-ink">Wearable IMUs</h2>
            <p className="text-[13px] text-ink-soft">
              {connectedCount > 0 ? `${connectedCount} paired` : "Pair sensors over Bluetooth for richer motion capture."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={phase === "scanning"}
          className="inline-flex items-center gap-2 rounded-pill border border-line px-4 py-2.5 text-sm text-ink transition-colors hover:bg-paper-soft disabled:opacity-60"
        >
          {phase === "scanning" ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
          ) : (
            <RefreshCw className="size-4" strokeWidth={1.8} />
          )}
          {phase === "scanning" ? "Scanning…" : phase === "found" ? "Re-scan" : "Scan for sensors"}
        </button>
      </div>

      <div className="mt-6">
        {phase === "idle" && (
          <div className="rounded-lg border border-dashed border-line bg-paper-soft/40 px-6 py-12 text-center">
            <Cpu className="mx-auto size-7 text-ink-faint" strokeWidth={1.5} />
            <p className="mx-auto mt-3 max-w-sm text-sm text-ink-soft">
              No sensors paired yet. Put your Mova IMUs in pairing mode and scan to connect.
            </p>
          </div>
        )}

        {phase === "scanning" && (
          <div className="grid place-items-center rounded-lg border border-line bg-paper-soft/40 px-6 py-12">
            <span className="relative grid size-16 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-signal/20" />
              <span className="grid size-12 place-items-center rounded-full bg-card ring-1 ring-signal/30">
                <Bluetooth className="size-6 text-signal" strokeWidth={1.7} />
              </span>
            </span>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint">
              Listening for nearby sensors…
            </p>
          </div>
        )}

        {phase === "found" && (
          <div className="space-y-2.5">
            {sensors.map((s) => (
              <SensorRow key={s.id} sensor={s} onToggle={() => toggle(s.id)} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SensorRow({ sensor, onToggle }: { sensor: Sensor; onToggle: () => void }) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-lg border p-4 transition-colors",
        sensor.connected ? "border-signal/30 bg-signal/[0.04]" : "border-line bg-card",
      )}
    >
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-xl ring-1",
          sensor.connected ? "bg-card text-signal-deep ring-signal/25" : "bg-paper-soft text-ink-soft ring-line",
        )}
      >
        <Cpu className="size-5" strokeWidth={1.6} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{sensor.name}</div>
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">{sensor.site}</div>
      </div>

      <SignalBars rssi={sensor.rssi} />
      <BatteryPill level={sensor.battery} />

      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "inline-flex w-28 items-center justify-center gap-1.5 rounded-pill px-3 py-2 text-[13px] font-medium transition-colors",
          sensor.connected
            ? "bg-signal/10 text-signal-deep hover:bg-signal/15"
            : "bg-night text-paper-soft hover:bg-ink",
        )}
      >
        {sensor.connected ? (
          <>
            <Check className="size-3.5" strokeWidth={2.2} /> Paired
          </>
        ) : (
          "Connect"
        )}
      </button>
    </div>
  );
}

function SignalBars({ rssi }: { rssi: number }) {
  // -45 dBm ≈ excellent, -85 ≈ poor → 1..4 bars
  const strength = Math.max(1, Math.min(4, Math.round((rssi + 90) / 12)));
  return (
    <div className="hidden items-end gap-0.5 sm:flex" title={`${rssi} dBm`} aria-label={`Signal ${strength} of 4`}>
      {[1, 2, 3, 4].map((b) => (
        <span
          key={b}
          className={cn("w-1 rounded-sm", b <= strength ? "bg-signal" : "bg-line")}
          style={{ height: `${5 + b * 3}px` }}
        />
      ))}
    </div>
  );
}

function BatteryPill({ level }: { level: number }) {
  const Icon = level > 66 ? Battery : level > 33 ? BatteryMedium : BatteryLow;
  const tone = level > 33 ? "text-ink-soft" : "text-amber-600";
  return (
    <span className={cn("hidden items-center gap-1 font-mono text-[12px] sm:inline-flex", tone)}>
      <Icon className="size-4" strokeWidth={1.7} />
      {level}%
    </span>
  );
}
