"use client";

// The clinician's plan editor: which exercises this patient is asked to do, how many repetitions, how often.
//
// Each row writes through clinic_set_prescription (migration 0043), which checks in the database that the caller
// is a clinician with an active care-team link to this patient. A failure is shown on the row that caused it and
// the switch goes back to what the database still holds — the screen never claims a change that did not happen.

import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { card, cardTitle, focusRing, sectionTitle, tileLabel } from "@/components/app/recipes";
import type { PlanRow } from "@/lib/clinic/patientPlan";
import { localized } from "@/lib/exercises/catalog";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Locale } from "@/locales";
import { useTranslation } from "@/locales/client";

interface RowState {
  active: boolean;
  reps: number | null;
  perWeek: number | null;
  saving: boolean;
  error: string | null;
  savedAt: number | null;
}

export default function AssignExercises({
  patientId,
  rows,
  locale,
}: {
  patientId: string;
  rows: PlanRow[];
  locale: Locale;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [state, setState] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      rows.map((row) => [
        row.entry.slug,
        {
          active: row.status === "active",
          reps: row.reps,
          perWeek: row.perWeek,
          saving: false,
          error: null,
          savedAt: null,
        },
      ]),
    ),
  );

  const patch = (slug: string, next: Partial<RowState>) =>
    setState((current) => ({ ...current, [slug]: { ...current[slug], ...next } }));

  async function save(row: PlanRow, next: Partial<Pick<RowState, "active" | "reps" | "perWeek">>) {
    const slug = row.entry.slug;
    const before = state[slug];
    const merged = { ...before, ...next };
    patch(slug, { ...next, saving: true, error: null });

    const { error } = await supabase.rpc("clinic_set_prescription", {
      p_patient: patientId,
      p_exercise: slug,
      p_active: merged.active,
      p_reps: merged.reps,
      p_per_week: merged.perWeek,
    });

    if (error) {
      // Back to what was on screen before the click: the database did not take the change.
      patch(slug, { active: before.active, reps: before.reps, perWeek: before.perWeek, saving: false, error: error.message });
      return;
    }
    patch(slug, { saving: false, error: null, savedAt: Date.now() });
    // Today, the plan page and the counts elsewhere read the same rows.
    router.refresh();
  }

  const assigned = rows.filter((row) => state[row.entry.slug]?.active).length;

  return (
    <section aria-labelledby="assign-title" className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="assign-title" className={sectionTitle}>
          {t("clinician.assign.title")}
        </h2>
        <p className="text-base text-ink-soft">{t("clinician.assign.count", { n: assigned, total: rows.length })}</p>
      </div>
      <p className="max-w-measure text-base leading-relaxed text-ink-soft">{t("clinician.assign.lead")}</p>

      <ul className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(min(100%,26rem),1fr))]">
        {rows.map((row) => {
          const slug = row.entry.slug;
          const rowState = state[slug];
          const unavailable = row.exerciseId === null;
          return (
            <li key={slug} className={cn(card, "p-5", rowState.active && "ring-1 ring-signal")}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className={cn(cardTitle, "text-lg")}>{localized(row.entry.name, locale)}</h3>
                  {row.entry.target && (
                    <p className="mt-1 text-[15px] leading-snug text-ink-soft">{localized(row.entry.target, locale)}</p>
                  )}
                </div>
                <label className="inline-flex shrink-0 items-center gap-2">
                  <span className="sr-only">{t("clinician.assign.toggle")}</span>
                  <input
                    type="checkbox"
                    className={cn("size-6 accent-[#0A6E3E]", focusRing)}
                    checked={rowState.active}
                    disabled={rowState.saving || unavailable}
                    onChange={(event) => void save(row, { active: event.target.checked })}
                  />
                </label>
              </div>

              {unavailable ? (
                <p className="mt-3 flex items-start gap-2 text-[15px] text-ink-soft">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {t("clinician.assign.unavailable")}
                </p>
              ) : (
                <div className="mt-4 flex flex-wrap items-end gap-4">
                  <label className="min-w-0">
                    <span className={tileLabel}>{t("clinician.assign.reps")}</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      inputMode="numeric"
                      className={cn(
                        "mt-1 h-12 w-24 rounded-md border border-line bg-card px-3 text-base tabular-nums text-ink",
                        focusRing,
                      )}
                      value={rowState.reps ?? ""}
                      disabled={rowState.saving}
                      onChange={(event) =>
                        patch(slug, { reps: event.target.value === "" ? null : Number(event.target.value) })
                      }
                      onBlur={() => {
                        if (rowState.reps !== row.reps) void save(row, { reps: rowState.reps });
                      }}
                    />
                  </label>
                  <label className="min-w-0">
                    <span className={tileLabel}>{t("clinician.assign.perWeek")}</span>
                    <input
                      type="number"
                      min={1}
                      max={21}
                      inputMode="numeric"
                      className={cn(
                        "mt-1 h-12 w-24 rounded-md border border-line bg-card px-3 text-base tabular-nums text-ink",
                        focusRing,
                      )}
                      value={rowState.perWeek ?? ""}
                      disabled={rowState.saving}
                      onChange={(event) =>
                        patch(slug, { perWeek: event.target.value === "" ? null : Number(event.target.value) })
                      }
                      onBlur={() => {
                        if (rowState.perWeek !== row.perWeek) void save(row, { perWeek: rowState.perWeek });
                      }}
                    />
                  </label>
                  <p className="min-h-12 flex-1 self-center text-[15px] text-ink-soft" aria-live="polite">
                    {rowState.saving && (
                      <span className="inline-flex items-center gap-2">
                        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                        {t("clinician.assign.saving")}
                      </span>
                    )}
                    {!rowState.saving && rowState.error && (
                      <span className="inline-flex items-start gap-2 text-ink">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        {t("clinician.assign.failed")}
                      </span>
                    )}
                    {!rowState.saving && !rowState.error && rowState.savedAt && (
                      <span className="inline-flex items-center gap-2 text-signal-deep">
                        <Check className="size-4" aria-hidden="true" />
                        {t("clinician.assign.saved")}
                      </span>
                    )}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
