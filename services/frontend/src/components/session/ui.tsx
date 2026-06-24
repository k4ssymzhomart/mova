// Editorial session primitives — the /session surface in the Mova "Modern Editorial & Spatial"
// language: paper/card surfaces, hairline `line` borders, soft 8px radii, Inter + tabular mono for
// live figures, emerald `signal` as the single accent. Replaces the retired monochrome kit.

"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Panel({
  label,
  right,
  children,
  className,
}: {
  label?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-card border border-line bg-card shadow-soft", className)}>
      {label && (
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">
            {label}
          </span>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-card border border-line bg-card p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">{label}</div>
      <div className="mt-2 font-mono text-3xl leading-none tabular-nums text-ink">
        {value}
        {unit && <span className="ml-1 text-base text-ink-faint">{unit}</span>}
      </div>
    </div>
  );
}

export function Bar({ value, tone = "signal" }: { value: number; tone?: "signal" | "ink" }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-pill bg-paper-soft">
      <div
        className={cn("h-full rounded-pill transition-[width] duration-300 ease-editorial", tone === "signal" ? "bg-signal" : "bg-ink")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function LivePill({ live }: { live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          live ? "animate-pulse bg-signal" : "bg-ink-faint/40",
        )}
      />
      {live ? "Live" : "Idle"}
    </span>
  );
}

export function PillButton({
  children,
  active = false,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...rest}
      className={cn(
        "rounded-pill border px-4 py-2 text-sm font-medium transition-all duration-300 ease-editorial hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0",
        active
          ? "border-night bg-night text-paper-soft"
          : "border-line bg-card text-ink hover:bg-paper-soft",
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className="flex w-full items-center justify-between gap-3 rounded-card border border-line bg-card px-4 py-3 text-left transition-colors hover:bg-paper-soft"
    >
      <span className="text-sm text-ink">{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 rounded-pill transition-colors duration-300",
          on ? "bg-signal" : "bg-paper-soft border border-line",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-card shadow-soft transition-transform duration-300 ease-editorial",
            on ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
