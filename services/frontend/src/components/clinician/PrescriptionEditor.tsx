"use client";

import { useState } from "react";

import { savePrescription } from "@/lib/clinic/store";
import type { Prescription } from "@/lib/clinic/types";
import type { Pack } from "@/lib/profile/types";
import { cn } from "@/lib/utils";

/** Prescription editor — pick a pack, set the weekly dose, and tune cadence/difficulty. Persists locally. */
export default function PrescriptionEditor({
  patientId,
  initial,
  onChange,
}: {
  patientId: string;
  initial: Prescription;
  onChange?: (rx: Prescription) => void;
}) {
  const [pack, setPack] = useState<Pack>(initial.pack);
  const [weeklyDoseSessions, setDose] = useState(initial.weeklyDoseSessions);
  const [targetCadenceSpm, setCadence] = useState(initial.targetCadenceSpm);
  const [difficulty, setDifficulty] = useState(initial.difficulty);
  const [note, setNote] = useState(initial.note);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty =
    pack !== initial.pack ||
    weeklyDoseSessions !== initial.weeklyDoseSessions ||
    targetCadenceSpm !== initial.targetCadenceSpm ||
    difficulty !== initial.difficulty ||
    note !== initial.note;

  const save = () => {
    const rx: Prescription = { pack, weeklyDoseSessions, targetCadenceSpm, difficulty, note, updatedAt: Date.now() };
    savePrescription(patientId, rx);
    setSavedAt(rx.updatedAt);
    onChange?.(rx);
  };

  return (
    <section className="rounded-card border border-line bg-card shadow-soft">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-faint">Prescription</span>
        {savedAt && !dirty && <span className="font-mono text-[11px] text-signal-deep">saved</span>}
      </header>

      <div className="space-y-5 p-4">
        {/* pack */}
        <div>
          <Label>Exercise pack</Label>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <PackButton active={pack === "reaching"} onClick={() => setPack("reaching")}>
              Upper-limb reaching
            </PackButton>
            <PackButton active={pack === "gait"} onClick={() => setPack("gait")}>
              Gait &amp; balance
            </PackButton>
          </div>
        </div>

        {/* dose */}
        <Slider
          label="Weekly dose"
          value={weeklyDoseSessions}
          min={1}
          max={14}
          step={1}
          display={`${weeklyDoseSessions} / wk`}
          onChange={setDose}
        />

        {/* cadence (gait) */}
        <Slider
          label="Target cadence"
          value={targetCadenceSpm}
          min={40}
          max={110}
          step={1}
          display={`${targetCadenceSpm} spm`}
          dim={pack !== "gait"}
          onChange={setCadence}
        />

        {/* difficulty */}
        <Slider
          label="Difficulty"
          value={Math.round(difficulty * 100)}
          min={0}
          max={100}
          step={5}
          display={`${Math.round(difficulty * 100)}%`}
          onChange={(v) => setDifficulty(v / 100)}
        />

        {/* note */}
        <div>
          <Label>Clinical note</Label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-2 w-full resize-none rounded-card border border-line bg-paper-soft px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition-colors focus:border-ink/30"
          />
        </div>

        <button
          onClick={save}
          disabled={!dirty}
          className="w-full rounded-pill bg-night px-5 py-2.5 text-sm font-medium text-paper-soft transition-colors hover:bg-ink disabled:opacity-40"
        >
          {dirty ? "Save prescription" : "Up to date"}
        </button>
      </div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-faint">{children}</span>;
}

function PackButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-card border px-3 py-2.5 text-[13px] font-medium transition-all duration-200",
        active ? "border-signal bg-signal/10 text-signal-deep" : "border-line bg-card text-ink-soft hover:bg-paper-soft",
      )}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  dim = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  dim?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className={dim ? "opacity-45" : ""}>
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-sm tabular-nums text-ink">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-signal"
      />
    </div>
  );
}
