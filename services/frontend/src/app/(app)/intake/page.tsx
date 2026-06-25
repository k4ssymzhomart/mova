"use client";

// Conversational intake — a <=2-minute onboarding in the editorial/spatial language. Four steps:
// condition -> affected side -> CV-guided ROM baseline -> review. On finish it builds a PatientProfile,
// persists it locally, and routes to the personalised live session. The review step also previews the
// mock FHIR bundle, making the medical-center integration boundary visible.

import { useRouter } from "next/navigation";
import { type ReactNode, useMemo, useState } from "react";

import BaselineCapture from "@/components/intake/BaselineCapture";
import { toFhirBundle } from "@/lib/fhir";
import { buildProfile, packForCondition, saveProfile } from "@/lib/profile/store";
import type { AffectedSide, Condition, RomBaseline } from "@/lib/profile/types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const CONDITIONS: { id: Condition; title: string; desc: string }[] = [
  { id: "stroke", title: "Stroke", desc: "Rebuilding strength and control after a cerebrovascular event." },
  { id: "parkinsons", title: "Parkinson's", desc: "Managing movement, gait, and freezing of gait." },
  { id: "ortho", title: "Ortho recovery", desc: "Recovering range and function after injury or surgery." },
];

const SIDES: { id: AffectedSide; title: string; desc: string }[] = [
  { id: "left", title: "Left", desc: "My left side needs the most work." },
  { id: "right", title: "Right", desc: "My right side needs the most work." },
  { id: "bilateral", title: "Both", desc: "Both sides — a bilateral focus." },
];

const PACK_LABEL = { reaching: "Upper-limb reaching", gait: "Gait & balance" } as const;
const STEPS = ["Condition", "Affected side", "Baseline", "Review"];

export default function IntakePage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [step, setStep] = useState(0);
  const [condition, setCondition] = useState<Condition | null>(null);
  const [side, setSide] = useState<AffectedSide | null>(null);
  const [baseline, setBaseline] = useState<RomBaseline | null>(null);
  const [showFhir, setShowFhir] = useState(false);

  const provisional = useMemo(
    () => (condition && side ? buildProfile(condition, side, baseline) : null),
    [condition, side, baseline],
  );

  const finish = async () => {
    if (!provisional) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    saveProfile(provisional, user?.id);
    router.push("/app/session/new");
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 flex items-center justify-end">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint">
          Step {Math.min(step + 1, STEPS.length)} of {STEPS.length} · {STEPS[step]}
        </span>
      </div>
          {/* progress */}
          <div className="mb-10 grid grid-cols-4 gap-2">
            {STEPS.map((s, i) => (
              <div key={s} className={cn("h-1 rounded-pill transition-colors duration-500", i <= step ? "bg-signal" : "bg-line")} />
            ))}
          </div>

          <section className="rounded-xl border border-line bg-card/80 p-6 shadow-card backdrop-blur-md sm:p-10">
            {step === 0 && (
              <Step
                eyebrow="Welcome to Mova"
                title="First — what are we"
                accent="working on?"
                hint="Your answer tailors the exercises and the model that watches your movement."
              >
                <Options>
                  {CONDITIONS.map((c) => (
                    <OptionCard
                      key={c.id}
                      title={c.title}
                      desc={c.desc}
                      selected={condition === c.id}
                      onClick={() => {
                        setCondition(c.id);
                        setStep(1);
                      }}
                    />
                  ))}
                </Options>
              </Step>
            )}

            {step === 1 && (
              <Step
                eyebrow="Personalising your program"
                title="Which side needs the"
                accent="most work?"
                hint="We focus scoring and difficulty on your affected side."
              >
                <Options>
                  {SIDES.map((c) => (
                    <OptionCard
                      key={c.id}
                      title={c.title}
                      desc={c.desc}
                      selected={side === c.id}
                      onClick={() => {
                        setSide(c.id);
                        setStep(2);
                      }}
                    />
                  ))}
                </Options>
                <BackRow onBack={() => setStep(0)} />
              </Step>
            )}

            {step === 2 && (
              <Step
                eyebrow="60-second calibration"
                title="Let's measure your"
                accent="starting range."
                hint="On-device only — the camera frame never leaves this browser. We keep just four max angles."
              >
                <BaselineCapture
                  onComplete={(b) => {
                    setBaseline(b);
                    setStep(3);
                  }}
                  onSkip={() => {
                    setBaseline(null);
                    setStep(3);
                  }}
                />
                <BackRow onBack={() => setStep(1)} />
              </Step>
            )}

            {step === 3 && provisional && (
              <Step
                eyebrow="You're set"
                title="Here's your starting"
                accent="plan."
                hint="You can recalibrate anytime — every session also refines what Mova knows about you."
              >
                <dl className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
                  <Fact k="Condition" v={CONDITIONS.find((c) => c.id === condition)?.title ?? "—"} />
                  <Fact k="Affected side" v={SIDES.find((c) => c.id === side)?.title ?? "—"} />
                  <Fact k="Recommended pack" v={PACK_LABEL[packForCondition(condition!)]} />
                </dl>

                {baseline ? (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Fact k="Arm · L" v={`${baseline.armElevationDeg.left}°`} tile />
                    <Fact k="Arm · R" v={`${baseline.armElevationDeg.right}°`} tile />
                    <Fact k="Knee · L" v={`${baseline.kneeRaiseDeg.left}°`} tile />
                    <Fact k="Knee · R" v={`${baseline.kneeRaiseDeg.right}°`} tile />
                  </div>
                ) : (
                  <p className="mt-4 rounded-card border border-line bg-paper-soft px-4 py-3 text-sm text-ink-soft">
                    No baseline captured — your games will start at a neutral difficulty. You can run the
                    calibration later.
                  </p>
                )}

                {/* FHIR boundary preview */}
                <button
                  onClick={() => setShowFhir((v) => !v)}
                  className="mt-5 flex w-full items-center justify-between rounded-card border border-line bg-paper-soft px-4 py-3 text-left text-sm text-ink transition-colors hover:bg-paper"
                >
                  <span>Medical-center handoff · mock FHIR bundle</span>
                  <span className="font-mono text-xs text-ink-faint">{showFhir ? "hide" : "view"}</span>
                </button>
                {showFhir && (
                  <pre className="mt-2 max-h-72 overflow-auto rounded-card border border-line bg-night px-4 py-3 font-mono text-[11px] leading-relaxed text-paper-soft">
                    {JSON.stringify(toFhirBundle(provisional), null, 2)}
                  </pre>
                )}

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <button
                    onClick={finish}
                    className="rounded-pill bg-night px-7 py-3 text-sm font-medium text-paper-soft transition-colors hover:bg-ink"
                  >
                    Save &amp; start your first session →
                  </button>
                  <button onClick={() => setStep(2)} className="text-sm text-ink-soft transition-colors hover:text-ink">
                    Recalibrate baseline
                  </button>
                </div>
              </Step>
            )}
          </section>
    </div>
  );
}

function Step({
  eyebrow,
  title,
  accent,
  hint,
  children,
}: {
  eyebrow: string;
  title: string;
  accent: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-ink-faint">{eyebrow}</div>
      <h1 className="mt-3 text-4xl leading-[1.05] text-ink sm:text-5xl">
        {title} <span className="text-signal-deep">{accent}</span>
      </h1>
      <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-ink-soft">{hint}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

function Options({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-3">{children}</div>;
}

function OptionCard({
  title,
  desc,
  selected,
  onClick,
}: {
  title: string;
  desc: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex h-full flex-col rounded-lg border bg-card p-5 text-left shadow-soft transition-all duration-300 ease-editorial hover:-translate-y-1 hover:shadow-card",
        selected ? "border-signal ring-2 ring-signal/30" : "border-line hover:border-ink/20",
      )}
    >
      <span className="text-2xl text-ink">{title}</span>
      <span className="mt-2 text-[13px] leading-relaxed text-ink-soft">{desc}</span>
      <span className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-ink-faint transition-colors group-hover:text-signal-deep">
        Select <span aria-hidden>→</span>
      </span>
    </button>
  );
}

function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <div className="mt-6">
      <button onClick={onBack} className="text-sm text-ink-soft transition-colors hover:text-ink">
        ← Back
      </button>
    </div>
  );
}

function Fact({ k, v, tile = false }: { k: string; v: string; tile?: boolean }) {
  if (tile) {
    return (
      <div className="rounded-card border border-line bg-card p-3">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint">{k}</div>
        <div className="mt-1 font-mono text-xl tabular-nums text-ink">{v}</div>
      </div>
    );
  }
  return (
    <div className="bg-card p-5">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-faint">{k}</div>
      <div className="mt-1.5 text-xl text-ink">{v}</div>
    </div>
  );
}
