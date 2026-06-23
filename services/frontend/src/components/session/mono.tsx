// Monochrome session primitives. Strict Vercel-native black/white: hairline borders, zero radius,
// no shadows, mono uppercase micro-labels. Reused across the /session surface.

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border border-black/15 bg-white ${className}`}>
      {title && (
        <header className="border-b border-black/15 px-3 py-2">
          <MonoLabel>{title}</MonoLabel>
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

export function MonoLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-black/60">{children}</span>
  );
}

export function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="border border-black/15 px-3 py-2">
      <MonoLabel>{label}</MonoLabel>
      <div className="mt-1 font-mono text-2xl leading-none tabular-nums text-black">
        {value}
        {unit && <span className="ml-1 text-sm text-black/50">{unit}</span>}
      </div>
    </div>
  );
}

export function GhostButton({
  children,
  active = false,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      {...rest}
      className={`rounded-none border px-4 py-2 font-mono text-xs uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-black bg-black text-white"
          : "border-black/30 bg-white text-black hover:border-black"
      }`}
    >
      {children}
    </button>
  );
}

export function Toggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      className="flex items-center justify-between gap-3 border border-black/15 px-3 py-2 text-left"
    >
      <MonoLabel>{label}</MonoLabel>
      <span className={`h-4 w-7 border border-black ${on ? "bg-black" : "bg-white"}`}>
        <span
          className={`block h-3 w-3 bg-white transition-transform ${
            on ? "translate-x-3 bg-white" : "translate-x-0 bg-black"
          }`}
          style={{ margin: "0.5px" }}
        />
      </span>
    </button>
  );
}

export function StatusDot({ state }: { state: "idle" | "loading" | "running" | "error" }) {
  const cls =
    state === "running"
      ? "bg-black"
      : state === "error"
        ? "bg-black/30"
        : state === "loading"
          ? "bg-black/60 animate-pulse"
          : "bg-white border border-black/40";
  return <span className={`inline-block h-2 w-2 ${cls}`} />;
}
