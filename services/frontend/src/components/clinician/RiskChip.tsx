import type { RiskSeverity } from "@/lib/clinic/types";

/** A single risk-flag pill. Emerald signal for high alerts, ink for watch, faint for info. */
export function RiskChip({ severity, label }: { severity: RiskSeverity; label: string }) {
  const cls =
    severity === "high"
      ? "border-signal-deep/30 bg-signal/12 text-signal-deep"
      : severity === "watch"
        ? "border-ink/20 bg-paper-soft text-ink"
        : "border-line bg-paper-soft text-ink-faint";
  const dot = severity === "high" ? "bg-signal" : severity === "watch" ? "bg-ink/50" : "bg-ink-faint/50";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11px] font-medium ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
