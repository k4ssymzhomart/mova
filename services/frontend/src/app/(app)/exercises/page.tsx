import type { Metadata } from "next";
import { ShieldCheck, Target } from "lucide-react";

import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Exercises · Mova" };

interface ExerciseRow {
  id: string;
  slug: string;
  name: string;
  modality: string;
  target_joints: string[] | null;
  difficulty: string | null;
  description: string | null;
  instructions: string | null;
  safety_notes: string | null;
}

const MODALITY_LABEL: Record<string, string> = {
  upper_limb_reaching: "Upper-limb reaching",
  hand_grasp: "Hand & grasp",
  head_neck: "Head & neck",
  gait_balance: "Gait & balance",
  sit_to_stand_lower_limb: "Sit-to-stand · lower limb",
};

const MODALITY_BLURB: Record<string, string> = {
  upper_limb_reaching: "Reach-to-target tasks — the richest computer-vision evidence base.",
  hand_grasp: "Fine motor grasp and release control.",
  head_neck: "Cervical range and gaze stabilisation.",
  gait_balance: "Gait and balance work, paired with the freezing-of-gait model.",
  sit_to_stand_lower_limb: "Lower-limb power and transfers.",
};

const SIDE: Record<string, string> = { l: "Left", r: "Right" };
function jointLabel(j: string): string {
  const [a, ...rest] = j.split("_");
  if ((a === "l" || a === "r") && rest.length) return `${SIDE[a]} ${rest.join(" ")}`;
  return j.replace(/_/g, " ");
}

export default async function ExercisesPage() {
  const supabase = createClient();
  const { data } = await supabase
    .from("exercises")
    .select(
      "id, slug, name, modality, target_joints, difficulty, description, instructions, safety_notes",
    )
    .eq("is_published", true)
    .order("modality", { ascending: true })
    .order("name", { ascending: true });

  const exercises = (data ?? []) as ExerciseRow[];

  // Group into modality sections, preserving first-seen order.
  const groups: { modality: string; items: ExerciseRow[] }[] = [];
  for (const ex of exercises) {
    let g = groups.find((x) => x.modality === ex.modality);
    if (!g) {
      g = { modality: ex.modality, items: [] };
      groups.push(g);
    }
    g.items.push(ex);
  }

  return (
    <div className="space-y-8">
      <header>
        <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-signal">Library</div>
        <h1 className="mt-2 font-serif text-4xl italic leading-none text-ink">
          The movement catalog.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-soft">
          Every exercise maps to a validated clinical metric. Each card explains the movement, the
          joints it targets, and what it&apos;s training for.
        </p>
      </header>

      {exercises.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-paper-soft/50 px-6 py-12 text-center text-sm text-ink-soft">
          The catalog is being prepared. Check back shortly.
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.modality}>
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <div>
                <h2 className="font-serif text-2xl italic text-ink">
                  {MODALITY_LABEL[group.modality] ?? group.modality}
                </h2>
                {MODALITY_BLURB[group.modality] && (
                  <p className="mt-0.5 text-[13px] text-ink-soft">{MODALITY_BLURB[group.modality]}</p>
                )}
              </div>
              <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                {group.items.length} {group.items.length === 1 ? "exercise" : "exercises"}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((ex) => (
                <article
                  key={ex.id}
                  className="flex flex-col rounded-lg border border-line bg-card p-5 transition-shadow hover:shadow-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-serif text-xl leading-tight text-ink">{ex.name}</h3>
                    {ex.difficulty && (
                      <span className="shrink-0 rounded-pill bg-paper-soft px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint ring-1 ring-line">
                        {ex.difficulty}
                      </span>
                    )}
                  </div>

                  {ex.description && (
                    <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">{ex.description}</p>
                  )}

                  <div className="mt-auto pt-4">
                    {ex.target_joints && ex.target_joints.length > 0 && (
                      <div className="flex items-start gap-1.5 font-mono text-[11px] text-ink-faint">
                        <Target className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.8} />
                        <span>{ex.target_joints.map(jointLabel).join(" · ")}</span>
                      </div>
                    )}
                    {ex.safety_notes && (
                      <div className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-ink-faint">
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-signal" strokeWidth={1.8} />
                        <span>{ex.safety_notes}</span>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
