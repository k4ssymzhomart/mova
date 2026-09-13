// One prescribed exercise (/program/<prescription id>): what it is, how often and how much, what to be careful
// about, and how to do it. Reference only: there is no start control, exercises start from Today.
//
// - The prescription is read by id AND the signed-in patient's patients.id, so another patient's id reads as
//   not found. RLS is not relied on to scope the row (#20).
// - An unknown, malformed or foreign id renders a not-found state with a way back. It never 404s.
// - A failed patients or prescriptions read renders a load error with the same way back. It is never shown as
//   not found, which would tell the patient the exercise is not in their plan.
// - A frequency of 0 or less is not a usable instruction and reads as "not specified", like a missing one.
// - Description, instructions, safety notes and the clinician note are shown verbatim. A missing safety note
//   says so, and never reads as "nothing to watch for".
// - Dose is jsonb with no fixed shape (0005_programs.sql: "sets / reps / duration"). Only recognised keys are
//   shown; anything else is reported as not displayable rather than printed raw. Only the prescription's own
//   dose is shown: a catalogue default is not this patient's prescription, so a missing dose says so.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, CloudOff, Info, NotebookPen, SearchX, ShieldAlert } from "lucide-react";

import EmptyState from "@/components/app/EmptyState";
import PageHeader from "@/components/app/PageHeader";
import { bodyText, card, cardTitle, secondaryButton, sectionTitle, tileLabel } from "@/components/app/recipes";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Locale } from "@/locales";
import { getTranslation } from "@/locales/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("plan.detail.metaTitle")} · Mova` };
}

type Translate = (key: string, vars?: Record<string, string | number>) => string;

// PostgREST returns a to-one embed as either an object or a single-element array.
type OneOrMany<T> = T | T[] | null;
function one<T>(v: OneOrMany<T>): T | null {
  return (Array.isArray(v) ? (v[0] ?? null) : v) ?? null;
}

interface ExerciseRow {
  name: string;
  description: string | null;
  instructions: string | null;
  safety_notes: string | null;
}

interface DetailRow {
  id: string;
  patient_id: string;
  status: string;
  difficulty: string | null;
  dose: unknown;
  frequency_per_week: number | null;
  clinician_note: string | null;
  exercise: OneOrMany<ExerciseRow>;
  program: OneOrMany<{ title: string; status: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOCALE_TAG: Record<Locale, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-GB" };

/** public.difficulty_level (0002_schemas_and_enums.sql). */
const DIFFICULTY_LEVELS = ["intro", "easy", "moderate", "hard", "expert"] as const;
function isDifficulty(value: unknown): value is (typeof DIFFICULTY_LEVELS)[number] {
  return typeof value === "string" && (DIFFICULTY_LEVELS as readonly string[]).includes(value);
}

/** The column default in 0005_programs.sql. It is not a title anyone chose, so it is shown translated. */
const DEFAULT_PROGRAM_TITLE = "Rehab program";

/** Picks the plural form with Intl, so Russian gets one/few/many. Every form key exists in every locale. */
function plural(t: Translate, locale: Locale, baseKey: string, n: number): string {
  const category = new Intl.PluralRules(LOCALE_TAG[locale]).select(n);
  const formatted = new Intl.NumberFormat(LOCALE_TAG[locale]).format(n);
  const key = `${baseKey}.${category}`;
  const value = t(key, { n: formatted });
  return value === key ? t(`${baseKey}.other`, { n: formatted }) : value;
}

// ---- dose ------------------------------------------------------------------------------------------------

type DoseField = "sets" | "reps" | "hold" | "duration" | "rest";
type DoseUnit = "count" | "seconds" | "minutes";

const DOSE_KEYS: Record<string, { field: DoseField; unit: DoseUnit }> = {
  sets: { field: "sets", unit: "count" },
  reps: { field: "reps", unit: "count" },
  repetitions: { field: "reps", unit: "count" },
  hold_s: { field: "hold", unit: "seconds" },
  hold_sec: { field: "hold", unit: "seconds" },
  hold_seconds: { field: "hold", unit: "seconds" },
  duration_s: { field: "duration", unit: "seconds" },
  duration_sec: { field: "duration", unit: "seconds" },
  duration_seconds: { field: "duration", unit: "seconds" },
  duration_min: { field: "duration", unit: "minutes" },
  duration_minutes: { field: "duration", unit: "minutes" },
  rest_s: { field: "rest", unit: "seconds" },
  rest_sec: { field: "rest", unit: "seconds" },
  rest_seconds: { field: "rest", unit: "seconds" },
};

interface DoseItem {
  key: string;
  field: DoseField;
  unit: DoseUnit;
  value: number;
}

interface ParsedDose {
  items: DoseItem[];
  /** The object has entries the app cannot show (unknown key or non-numeric value). */
  hasUnreadable: boolean;
  /** No entries at all: nothing was recorded. */
  isEmpty: boolean;
}

function parseDose(raw: unknown): ParsedDose {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { items: [], hasUnreadable: raw != null && typeof raw !== "object", isEmpty: raw == null };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  const items: DoseItem[] = [];
  let hasUnreadable = false;
  for (const [key, rawValue] of entries) {
    const known = DOSE_KEYS[key];
    const value = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" ? Number(rawValue) : NaN;
    if (known && Number.isFinite(value) && value > 0) {
      items.push({ key, ...known, value });
    } else {
      hasUnreadable = true;
    }
  }
  return { items, hasUnreadable, isEmpty: entries.length === 0 };
}

function doseValue(t: Translate, locale: Locale, item: DoseItem): string {
  if (item.unit === "seconds") return plural(t, locale, "plan.units.seconds", item.value);
  if (item.unit === "minutes") return plural(t, locale, "plan.units.minutes", item.value);
  return new Intl.NumberFormat(LOCALE_TAG[locale]).format(item.value);
}

// ---- page ------------------------------------------------------------------------------------------------

export default async function PlanDetailPage({ params }: { params: { prescriptionId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin?next=/program");

  const { t, locale } = getTranslation();

  let row: DetailRow | null = null;
  let loadFailed = false;
  if (UUID.test(params.prescriptionId)) {
    const { data: patient, error: patientError } = await supabase
      .from("patients")
      .select("id")
      .eq("profile_id", user.id)
      .maybeSingle();
    if (patientError) {
      loadFailed = true;
    } else if (patient?.id) {
      const { data, error } = await supabase
        .from("prescriptions")
        .select(
          `id, patient_id, status, difficulty, dose, frequency_per_week, clinician_note,
           exercise:exercises(name, description, instructions, safety_notes),
           program:programs(title, status)`,
        )
        .eq("id", params.prescriptionId)
        .eq("patient_id", patient.id)
        .maybeSingle();
      if (error) {
        loadFailed = true;
      } else {
        const candidate = (data ?? null) as DetailRow | null;
        row = candidate?.patient_id === patient.id ? candidate : null;
      }
    }
  }

  if (loadFailed) return <LoadError t={t} />;

  const exercise = row ? one(row.exercise) : null;
  if (!row || !exercise) return <NotFound t={t} />;

  const program = one(row.program);
  const programTitle = program
    ? program.title === DEFAULT_PROGRAM_TITLE
      ? t("plan.programUntitled")
      : program.title
    : null;
  const inactive = row.status !== "active" || (program != null && program.status !== "active");

  return (
    <div className="space-y-8">
      <BackLink t={t} />

      <PageHeader eyebrow={t("nav.plan")} title={exercise.name}>
        {programTitle && <p className={cn("mt-3", tileLabel)}>{t("plan.detail.fromProgram", { title: programTitle })}</p>}
      </PageHeader>

      {inactive && (
        <section
          aria-labelledby="plan-inactive"
          className={cn(card, "flex items-start gap-4 border-2 border-ink/40 p-5 sm:p-6")}
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-paper-soft text-ink ring-1 ring-line">
            <Info className="size-5" strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="plan-inactive" className={cardTitle}>
              {t("plan.detail.inactive.title")}
            </h2>
            <p className={cn("mt-2", bodyText)}>{t("plan.detail.inactive.body")}</p>
          </div>
        </section>
      )}

      {exercise.description && (
        <section aria-labelledby="plan-about" className={cn(card, "p-5 sm:p-6")}>
          <h2 id="plan-about" className={sectionTitle}>
            {t("plan.detail.about")}
          </h2>
          <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-ink">{exercise.description}</p>
        </section>
      )}

      <PrescriptionSection row={row} exercise={exercise} t={t} locale={locale} />

      <SafetySection notes={exercise.safety_notes} t={t} />

      <section aria-labelledby="plan-instructions" className={cn(card, "p-5 sm:p-6")}>
        <h2 id="plan-instructions" className={sectionTitle}>
          {t("plan.detail.instructions.title")}
        </h2>
        {exercise.instructions ? (
          <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-ink">{exercise.instructions}</p>
        ) : (
          <p className={cn("mt-3", bodyText)}>{t("plan.detail.instructions.missing")}</p>
        )}
      </section>
    </div>
  );
}

function BackLink({ t }: { t: Translate }) {
  return (
    <Link href="/program" className={secondaryButton}>
      <ChevronLeft className="size-5" strokeWidth={2} aria-hidden="true" />
      {t("plan.detail.back")}
    </Link>
  );
}

function NotFound({ t }: { t: Translate }) {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t("nav.plan")} title={t("plan.detail.notFound.title")} />
      <EmptyState
        icon={SearchX}
        title={t("plan.detail.notFound.emptyTitle")}
        body={t("plan.detail.notFound.body")}
        action={<BackLink t={t} />}
      />
    </div>
  );
}

function LoadError({ t }: { t: Translate }) {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow={t("nav.plan")} title={t("plan.detail.metaTitle")} />
      <EmptyState
        icon={CloudOff}
        title={t("plan.detail.error.title")}
        body={t("plan.detail.error.body")}
        action={<BackLink t={t} />}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card bg-paper-soft p-4 ring-1 ring-line">
      <dt className={tileLabel}>{label}</dt>
      <dd className="tnum mt-1 text-lg font-semibold text-ink">{value}</dd>
    </div>
  );
}

function PrescriptionSection({
  row,
  exercise,
  t,
  locale,
}: {
  row: DetailRow;
  exercise: ExerciseRow;
  t: Translate;
  locale: Locale;
}) {
  const prescribed = parseDose(row.dose);

  let doseItems: DoseItem[] = [];
  let doseNote: string | null = null;
  if (prescribed.items.length > 0) {
    doseItems = prescribed.items;
    if (prescribed.hasUnreadable) doseNote = t("plan.detail.dose.partial");
  } else if (!prescribed.isEmpty) {
    doseNote = t("plan.detail.dose.unreadable");
  } else {
    doseNote = t("plan.detail.dose.missing");
  }

  return (
    <section aria-labelledby="plan-prescription" className={cn(card, "p-5 sm:p-6")}>
      <h2 id="plan-prescription" className={sectionTitle}>
        {t("plan.detail.prescription")}
      </h2>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <Fact
          label={t("plan.frequencyLabel")}
          value={
            row.frequency_per_week != null && row.frequency_per_week > 0
              ? plural(t, locale, "plan.frequency", row.frequency_per_week)
              : t("plan.frequencyUnknown")
          }
        />
        {isDifficulty(row.difficulty) && (
          <Fact label={t("plan.difficultyLabel")} value={t(`plan.difficulty.${row.difficulty}`)} />
        )}
      </dl>

      <h3 className={cn("mt-6", cardTitle)}>{t("plan.detail.dose.title")}</h3>
      {doseItems.length > 0 && (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {doseItems.map((item) => (
            <Fact key={item.key} label={t(`plan.detail.dose.${item.field}`)} value={doseValue(t, locale, item)} />
          ))}
        </dl>
      )}
      {doseNote && <p className={cn("mt-3", bodyText)}>{doseNote}</p>}

      {row.clinician_note && (
        <div className="mt-6 rounded-card bg-paper-soft p-4 ring-1 ring-line">
          <h3 className="flex items-center gap-2 text-base font-semibold text-ink">
            <NotebookPen className="size-5 shrink-0 text-ink-soft" strokeWidth={1.9} aria-hidden="true" />
            {t("plan.clinicianNote")}
          </h3>
          <p className="mt-2 whitespace-pre-line text-base leading-relaxed text-ink">{row.clinician_note}</p>
        </div>
      )}
    </section>
  );
}

function SafetySection({ notes, t }: { notes: string | null; t: Translate }) {
  if (!notes) {
    return (
      <section aria-labelledby="plan-safety" className={cn(card, "p-5 sm:p-6")}>
        <div className="flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-paper-soft text-ink-soft ring-1 ring-line">
            <Info className="size-5" strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="plan-safety" className={cardTitle}>
              {t("plan.detail.safety.title")}
            </h2>
            <p className="mt-2 text-base font-medium text-ink">{t("plan.detail.safety.missing")}</p>
            <p className={cn("mt-1", bodyText)}>{t("plan.detail.safety.missingBody")}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="plan-safety"
      className="rounded-card border-2 border-amber-700 bg-amber-50 p-5 sm:p-6"
    >
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-card text-amber-700 ring-1 ring-amber-700/30">
          <ShieldAlert className="size-5" strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="plan-safety" className={cardTitle}>
            {t("plan.detail.safety.title")}
          </h2>
          <p className="mt-2 whitespace-pre-line text-base leading-relaxed text-ink">{notes}</p>
        </div>
      </div>
    </section>
  );
}
