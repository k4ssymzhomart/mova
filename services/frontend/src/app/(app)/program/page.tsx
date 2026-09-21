// Plan (/program). The full prescription and the rules of recovery, kept off the "start now" screen: there is
// deliberately no start control here, exercises start from Today. This page is the precautions' home.
//
// - Rows are filtered to the signed-in patient explicitly (patients.id via profile_id), not left to RLS (#20).
// - A failed patients or programs read renders a load error, never the "no plan yet" empty state.
// - Clinician-written text (program notes, prescription notes) is shown verbatim.
// - A frequency of 0 or less is not a usable instruction and reads as "not specified", like a missing one.
// - No adherence, quality or other session metrics: those came from the camera pipeline. TKA scores come
//   from the scoring engine (#23) and belong on Progress, not here.
// - No protocol phase and no target joints: there is no data for the first, and an English side label for the
//   second would contradict the operated-side badge in the shell.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, ClipboardList, CloudOff, Dumbbell, NotebookPen, Users } from "lucide-react";

import EmptyState from "@/components/app/EmptyState";
import PageHeader from "@/components/app/PageHeader";
import PrecautionsCard from "@/components/app/PrecautionsCard";
import {
  bodyText,
  card,
  cardGrid,
  cardTitle,
  focusRing,
  pageFlow,
  secondaryButton,
  sectionHead,
  sectionTitle,
  tileLabel,
} from "@/components/app/recipes";
import { getPatientContext } from "@/lib/patient/context";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Locale } from "@/locales";
import { getTranslation } from "@/locales/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("plan.metaTitle")} · Mova` };
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

// PostgREST returns a to-one embed as either an object or a single-element array.
type OneOrMany<T> = T | T[] | null;
function one<T>(v: OneOrMany<T>): T | null {
  return (Array.isArray(v) ? (v[0] ?? null) : v) ?? null;
}

interface PrescriptionRow {
  id: string;
  patient_id: string;
  status: string;
  difficulty: string | null;
  frequency_per_week: number | null;
  clinician_note: string | null;
  created_at: string;
  exercise: OneOrMany<{ name: string }>;
}

interface ProgramRow {
  id: string;
  title: string;
  notes: string | null;
  prescriptions: PrescriptionRow[] | null;
}

const LOCALE_TAG: Record<Locale, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-GB" };

/** public.difficulty_level (0002_schemas_and_enums.sql). */
const DIFFICULTY_LEVELS = ["intro", "easy", "moderate", "hard", "expert"] as const;
function isDifficulty(value: unknown): value is (typeof DIFFICULTY_LEVELS)[number] {
  return typeof value === "string" && (DIFFICULTY_LEVELS as readonly string[]).includes(value);
}

/** The column default in 0005_programs.sql. It is not a title anyone chose, so it is shown translated. */
const DEFAULT_PROGRAM_TITLE = "Rehab program";

/** "{n} раза в неделю": plural category from Intl, so Russian gets one/few/many. */
function frequencyText(t: Translate, locale: Locale, n: number): string {
  const category = new Intl.PluralRules(LOCALE_TAG[locale]).select(n);
  const key = `plan.frequency.${category}`;
  const value = t(key, { n: new Intl.NumberFormat(LOCALE_TAG[locale]).format(n) });
  return value === key ? t("plan.frequency.other", { n }) : value;
}

export default async function PlanPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin?next=/program");

  const { t, locale } = getTranslation();

  const [context, { data: patient, error: patientError }] = await Promise.all([
    getPatientContext(user.id),
    supabase.from("patients").select("id").eq("profile_id", user.id).maybeSingle(),
  ]);

  // A failed read is shown as a load error. It must never fall through to "the clinic has not set up your plan".
  let loadFailed = Boolean(patientError);
  let program: ProgramRow | null = null;
  if (!loadFailed && patient?.id) {
    const { data, error } = await supabase
      .from("programs")
      .select(
        `id, title, notes,
         prescriptions:prescriptions(
           id, patient_id, status, difficulty, frequency_per_week, clinician_note, created_at,
           exercise:exercises(name)
         )`,
      )
      .eq("patient_id", patient.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) loadFailed = true;
    else program = (data ?? null) as ProgramRow | null;
  }

  const prescriptions = (program?.prescriptions ?? [])
    .filter((p) => p.status === "active" && p.patient_id === patient?.id && one(p.exercise))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <div className={pageFlow}>
      <PageHeader eyebrow={t("nav.plan")} title={t("plan.title")} lead={t("plan.lead")} />

      <PrecautionsCard precautions={context.precautions} />

      {loadFailed ? (
        <EmptyState icon={CloudOff} title={t("plan.error.title")} body={t("plan.error.body")} />
      ) : !program ? (
        <EmptyState
          icon={ClipboardList}
          title={t("plan.empty.title")}
          body={t("plan.empty.body")}
          action={
            <Link href="/care-team" className={secondaryButton}>
              <Users className="size-5" strokeWidth={1.9} aria-hidden="true" />
              {t("nav.careTeam")}
            </Link>
          }
        />
      ) : (
        <>
          <section aria-labelledby="plan-program" className={cn(card, "p-5 sm:p-6")}>
            <p className={tileLabel}>{t("plan.programLabel")}</p>
            <h2 id="plan-program" className={cn("mt-1", sectionTitle)}>
              {program.title === DEFAULT_PROGRAM_TITLE ? t("plan.programUntitled") : program.title}
            </h2>
            {program.notes && (
              <div className="mt-5 rounded-card bg-paper-soft p-4 ring-1 ring-line">
                <p className="flex items-center gap-2 text-base font-semibold text-ink">
                  <NotebookPen className="size-5 shrink-0 text-ink-soft" strokeWidth={1.9} aria-hidden="true" />
                  {t("plan.careTeamNote")}
                </p>
                <p className="mt-2 whitespace-pre-line text-base leading-relaxed text-ink">{program.notes}</p>
              </div>
            )}
          </section>

          <section aria-labelledby="plan-exercises" className="space-y-4">
            <div className={sectionHead}>
              <h2 id="plan-exercises" className={sectionTitle}>
                {t("plan.exercises.title")}
              </h2>
              {prescriptions.length > 0 && (
                <p className={tileLabel}>{t("plan.exercises.count", { n: prescriptions.length })}</p>
              )}
            </div>

            {prescriptions.length === 0 ? (
              <EmptyState
                icon={Dumbbell}
                headingLevel={3}
                title={t("plan.exercises.emptyTitle")}
                body={t("plan.exercises.emptyBody")}
              />
            ) : (
              <ul className={cardGrid}>
                {prescriptions.map((p) => (
                  <li key={p.id}>
                    <PrescriptionCard prescription={p} t={t} locale={locale} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function PrescriptionCard({
  prescription: p,
  t,
  locale,
}: {
  prescription: PrescriptionRow;
  t: Translate;
  locale: Locale;
}) {
  const name = one(p.exercise)?.name ?? "";
  return (
    <Link
      href={`/program/${p.id}`}
      className={cn(
        card,
        focusRing,
        "flex h-full min-h-12 flex-col p-5 transition-colors hover:border-ink/30 hover:bg-paper-soft sm:p-6",
      )}
    >
      <h3 className={cardTitle}>{name}</h3>

      <dl className="mt-4 space-y-2 text-base">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-ink-soft">{t("plan.frequencyLabel")}:</dt>
          <dd className="font-medium text-ink">
            {p.frequency_per_week != null && p.frequency_per_week > 0
              ? frequencyText(t, locale, p.frequency_per_week)
              : t("plan.frequencyUnknown")}
          </dd>
        </div>
        {isDifficulty(p.difficulty) && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-ink-soft">{t("plan.difficultyLabel")}:</dt>
            <dd className="font-medium text-ink">{t(`plan.difficulty.${p.difficulty}`)}</dd>
          </div>
        )}
      </dl>

      {p.clinician_note && (
        <div className="mt-4 rounded-card bg-paper-soft p-3 ring-1 ring-line">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <NotebookPen className="size-4 shrink-0 text-ink-soft" strokeWidth={1.9} aria-hidden="true" />
            {t("plan.clinicianNote")}
          </p>
          <p className={cn("mt-1 whitespace-pre-line", bodyText)}>{p.clinician_note}</p>
        </div>
      )}

      <span className="mt-auto flex items-center gap-1 pt-4 text-base font-medium text-signal-deep">
        {t("plan.details")}
        <ChevronRight className="size-5" strokeWidth={2} aria-hidden="true" />
      </span>
    </Link>
  );
}
