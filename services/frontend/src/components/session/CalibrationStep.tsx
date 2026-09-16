"use client";

// CalibrationStep — the in-flow "hold still 2-3s, zero the reference" step that runs before every set
// (spec's per-exercise calibration text). Presentational only: ExerciseStudio owns the actual
// CalibrationCapture instance (lib/scoring/calibration.ts) and passes down live progress, so this
// component has no state of its own to fall out of sync with the real capture.

import { Loader2 } from "lucide-react";

import { SENSOR_ROLE_LABEL, type SensorRole } from "@/lib/ble/roles";

import { Bar, Panel, PillButton } from "./ui";

export default function CalibrationStep({
  requiredRoles,
  connectedRoles,
  progress01,
  onConnectMissing,
}: {
  requiredRoles: SensorRole[];
  connectedRoles: SensorRole[];
  progress01: number;
  onConnectMissing: (role: SensorRole) => void;
}) {
  const missing = requiredRoles.filter((r) => !connectedRoles.includes(r));

  if (missing.length > 0) {
    return (
      <Panel label="Подключите датчики">
        <div className="space-y-2.5">
          {missing.map((role) => (
            <div key={role} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-paper-soft/40 px-4 py-3">
              <span className="text-sm text-ink">{SENSOR_ROLE_LABEL[role]}</span>
              <PillButton onClick={() => onConnectMissing(role)}>Подключить</PillButton>
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  return (
    <Panel label="Калибровка">
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 shrink-0 animate-spin text-signal" strokeWidth={1.8} />
        <p className="text-sm text-ink">Держите ногу неподвижно несколько секунд…</p>
      </div>
      <div className="mt-3">
        <Bar value={progress01} tone="signal" />
      </div>
    </Panel>
  );
}
