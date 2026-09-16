"use client";

// LiveCuePanel — renders exactly the one active LiveCue selected by lib/scoring/cuePriority.ts. Text is
// verbatim from the spec's priority-ladder table (docx §9.1) — never a second, competing message.

import { AlertTriangle, CheckCircle2, Gauge, MoveRight, RotateCcw, Sparkles, Target } from "lucide-react";

import { describeSignalQuality, type SignalQualityReport } from "@/lib/ble/signalQuality";
import type { CueCode, LiveCue } from "@/lib/scoring/types";
import { cn } from "@/lib/utils";

const CUE_TEXT: Record<Exclude<CueCode, "sensor_problem">, string> = {
  rep_incomplete: "Верните ногу в исходное положение",
  target_far: "Согните чуть больше, если комфортно",
  target_close: "Почти! Еще немного до цели",
  too_fast: "Медленнее",
  low_smoothness: "Плавнее, без рывка",
  all_good: "Отлично! Продолжайте так же",
};

const CUE_ICON: Record<CueCode, typeof AlertTriangle> = {
  sensor_problem: AlertTriangle,
  rep_incomplete: RotateCcw,
  target_far: MoveRight,
  target_close: Target,
  too_fast: Gauge,
  low_smoothness: MoveRight,
  all_good: CheckCircle2,
};

const CUE_TONE: Record<CueCode, string> = {
  sensor_problem: "border-amber-400/50 bg-amber-500/10 text-amber-700",
  rep_incomplete: "border-line bg-paper-soft text-ink",
  target_far: "border-line bg-paper-soft text-ink",
  target_close: "border-signal/30 bg-signal/[0.06] text-signal-deep",
  too_fast: "border-line bg-paper-soft text-ink",
  low_smoothness: "border-line bg-paper-soft text-ink",
  all_good: "border-signal/30 bg-signal/[0.08] text-signal-deep",
};

export default function LiveCuePanel({ cue, signal }: { cue: LiveCue | null; signal: SignalQualityReport | null }) {
  if (!cue) return null;

  const Icon = CUE_ICON[cue.code];
  const text =
    cue.code === "sensor_problem"
      ? (signal ? describeSignalQuality(signal)[0] : null) ?? "Проблема с датчиком"
      : CUE_TEXT[cue.code];

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 text-[15px] leading-snug transition-colors",
        CUE_TONE[cue.code],
      )}
      role="status"
      aria-live="polite"
    >
      <Icon className="size-5 shrink-0" strokeWidth={1.9} />
      {cue.code === "all_good" ? <Sparkles className="size-4 shrink-0" strokeWidth={1.9} /> : null}
      <span>{text}</span>
    </div>
  );
}
