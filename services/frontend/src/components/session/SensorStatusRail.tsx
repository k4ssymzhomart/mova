"use client";

// SensorStatusRail — the missing per-role (THIGH/SHANK/FOOT) signal-quality breakdown. Today only
// DevicesClient's aggregate SignalQualityBanner exists ("all sensors synced" / one bundled warning);
// SignalQualityReport already carries per-role sampleRatesHz/packetCounts, this just surfaces them. Built
// for the exercise screen (Track C) but usable anywhere three-sensor status needs to render compactly.

import { AlertTriangle, Cpu } from "lucide-react";

import { SENSOR_ROLE_LABEL, SENSOR_ROLE_ORDER, type SensorRole } from "@/lib/ble/roles";
import { MIN_SAMPLE_RATE_HZ, type SignalQualityReport } from "@/lib/ble/signalQuality";
import type { SensorUiStatus } from "@/lib/ble/useSensorConnect";
import { cn } from "@/lib/utils";

import { Panel } from "./ui";

type RoleTone = "idle" | "waiting" | "ready" | "slow" | "missing";

function toneFor(
  role: SensorRole,
  status: SensorUiStatus,
  receiving: boolean,
  quality: SignalQualityReport | null,
): RoleTone {
  if (status !== "connected") return "idle";
  if (!receiving) return "waiting";
  if (quality?.reasons.some((r) => r.startsWith("missing_sensor_roles:") && r.includes(role))) return "missing";
  const rate = quality?.sampleRatesHz[role];
  if (rate !== undefined && rate < MIN_SAMPLE_RATE_HZ) return "slow";
  return "ready";
}

const TONE_META: Record<RoleTone, { label: string; dot: string; text: string }> = {
  idle: { label: "Не подключён", dot: "bg-ink-faint", text: "text-ink-faint" },
  waiting: { label: "Ожидание данных", dot: "bg-amber-500", text: "text-amber-600" },
  ready: { label: "Готов", dot: "bg-signal", text: "text-signal-deep" },
  slow: { label: "Медленный сигнал", dot: "bg-amber-500", text: "text-amber-600" },
  missing: { label: "Нет данных", dot: "bg-destructive", text: "text-destructive" },
};

export interface SensorStatusRailProps {
  statuses: Record<SensorRole, SensorUiStatus>;
  receivingData: Record<SensorRole, boolean>;
  quality: SignalQualityReport | null;
  className?: string;
}

export default function SensorStatusRail({ statuses, receivingData, quality, className }: SensorStatusRailProps) {
  return (
    <Panel label="Датчики" className={className}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {SENSOR_ROLE_ORDER.map((role) => {
          const tone = toneFor(role, statuses[role], receivingData[role], quality);
          const meta = TONE_META[tone];
          return (
            <div
              key={role}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border px-3 py-2.5",
                tone === "ready" ? "border-signal/25 bg-signal/[0.04]" : "border-line bg-card",
              )}
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-lg ring-1",
                  tone === "ready" ? "bg-card text-signal-deep ring-signal/25" : "bg-paper-soft text-ink-soft ring-line",
                )}
              >
                <Cpu className="size-4" strokeWidth={1.6} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{SENSOR_ROLE_LABEL[role]}</div>
                <div className={cn("flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em]", meta.text)}>
                  <span className={cn("size-1.5 rounded-full", meta.dot)} />
                  {meta.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {quality && !quality.scoringPermitted && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3.5 py-2.5 text-[12px] text-amber-700">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
          Оценка приостановлена, пока качество сигнала не восстановится.
        </div>
      )}
    </Panel>
  );
}
