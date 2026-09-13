// Today (/app): the first screen of the patient app, with one job (НТЗ §16.2): the exercises the clinic has
// prescribed and the way into the exercise flow. Post-operative day and operated side come from the shell and
// are not repeated here.
//
// - The list is the active prescriptions of the patient's newest active program. There is no per-day schedule
//   yet, so nothing here says an exercise is "due today".
// - Rows are filtered to the signed-in patient explicitly, not left to RLS (#20 is reworking it).
// - No scores and no session history: camera-era session_metrics are never read. TKA scores arrive with #23.
// - Dose is not shown. Nothing in supabase/migrations or seed.sql defines the keys inside prescriptions.dose,
//   so any rendering would be a guess. TODO(#20): show sets / reps / hold once the TKA schema fixes the shape.
// - A failed read says so. It is never shown as "no plan", which would tell the patient something untrue.

import { CalendarDays, ClipboardList, CloudOff, Play } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import EmptyState from "@/components/app/EmptyState";
import LocalDateTime from "@/components/app/LocalDateTime";
import PageHeader from "@/components/app/PageHeader";
import PrecautionsCard from "@/components/app/PrecautionsCard";
import { bodyText, card, cardTitle, primaryButton, sectionTitle } from "@/components/app/recipes";
import { getPatientContext } from "@/lib/patient/context";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/locales";
import { getTranslation } from "@/locales/server";

const INTL_LOCALE: Record<Locale, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-GB" };

type Translate = (key: string, vars?: Record<string, string | number>) => string;
type SupabaseServer = ReturnType<typeof createClient>;

interface ExerciseRef {
  name: string | null;
  slug: string | null;
}
interface PrescriptionRow {
  id: string;
  frequency_per_week: number | null;
  exercise: ExerciseRef | ExerciseRef[] | null;
}
interface ExerciseItem {
  prescriptionId: string;
  name: string | null;
  perWeek: number | null;
}
type ExerciseList = { status: "error" } | { status: "none" } | { status: "ok"; items: ExerciseItem[] };

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("today.metaTitle")} · Mova` };
}

export default async function TodayPage() {
  const { t, locale } = getTranslation();
  const supabase = createClient();
  // Creates the patients row for a first-time self-serve user. Idempotent, and must run before the reads below.
  await supabase.rpc("provision_self_serve_patient");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // the layout redirects; this guards the race so we never deref a null user

  const [{ data: profile }, exercises, context] = await Promise.all([
    supabase.from("profiles").select("full_name, display_name").eq("id", user.id).maybeSingle(),
    loadExercises(supabase, user.id),
    getPatientContext(user.id),
  ]);

  const name =
    profile?.display_name?.trim() || profile?.full_name?.trim() || user.email?.split("@")[0]?.trim() || null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={<LocalDateTime iso={new Date().toISOString()} format="weekday" />}
        title={name ? t("today.greeting", { name }) : t("today.greetingNoName")}
      />

      <PrecautionsCard precautions={context.precautions} />

      <section aria-labelledby="today-exercises" className="space-y-4">
        <div>
          <h2 id="today-exercises" className={sectionTitle}>
            {t("today.exercisesTitle")}
          </h2>
          {exercises.status === "ok" && <p className={`mt-2 max-w-2xl ${bodyText}`}>{t("today.exercisesLead")}</p>}
        </div>

        {exercises.status === "error" && (
          <EmptyState icon={CloudOff} headingLevel={3} title={t("today.errorTitle")} body={t("today.errorBody")} />
        )}

        {exercises.status === "none" && (
          <EmptyState
            icon={ClipboardList}
            headingLevel={3}
            title={t("today.emptyTitle")}
            body={t("today.emptyBody")}
          />
        )}

        {exercises.status === "ok" && (
          <ul className="space-y-4">
            {exercises.items.map((item) => (
              <ExerciseCard key={item.prescriptionId} item={item} t={t} locale={locale} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ExerciseCard({ item, t, locale }: { item: ExerciseItem; t: Translate; locale: Locale }) {
  const titleId = `rx-${item.prescriptionId}-title`;
  const startId = `rx-${item.prescriptionId}-start`;
  return (
    <li className={`${card} flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6`}>
      <div className="min-w-0">
        {/* Exercise name as stored in the catalog; it is not translated. */}
        <h3 id={titleId} className={`${cardTitle} break-words`}>
          {item.name ?? t("today.nameUnavailable")}
        </h3>
        {item.perWeek != null && (
          <p className="mt-2 flex items-center gap-2 text-base text-ink-soft">
            <CalendarDays className="size-5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
            {perWeekLabel(t, locale, item.perWeek)}
          </p>
        )}
      </div>
      {/* Every card has a "Start" button, so the accessible name adds the exercise: "Start, <name>". */}
      <Link
        id={startId}
        href={`/app/session/new/${encodeURIComponent(item.prescriptionId)}`}
        prefetch={false}
        aria-labelledby={`${startId} ${titleId}`}
        className={`${primaryButton} w-full shrink-0 sm:w-auto`}
      >
        <Play className="size-5" strokeWidth={2} aria-hidden="true" />
        {t("today.start")}
      </Link>
    </li>
  );
}

async function loadExercises(supabase: SupabaseServer, profileId: string): Promise<ExerciseList> {
  const { data: patient, error: patientError } = await supabase
    .from("patients")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (patientError) return { status: "error" };
  if (!patient) return { status: "none" };

  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("id")
    .eq("patient_id", patient.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (programError) return { status: "error" };
  if (!program) return { status: "none" };

  const { data, error } = await supabase
    .from("prescriptions")
    .select("id, frequency_per_week, exercise:exercises(name, slug)")
    .eq("patient_id", patient.id)
    .eq("program_id", program.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) return { status: "error" };

  const items = ((data ?? []) as unknown as PrescriptionRow[]).map((row): ExerciseItem => {
    const exercise = Array.isArray(row.exercise) ? (row.exercise[0] ?? null) : row.exercise;
    return {
      prescriptionId: row.id,
      name: exercise?.name?.trim() || null,
      // 0 is allowed by the column check but is not a usable instruction, so it is left out like null.
      perWeek: row.frequency_per_week != null && row.frequency_per_week > 0 ? row.frequency_per_week : null,
    };
  });
  return items.length > 0 ? { status: "ok", items } : { status: "none" };
}

/** "{n} раз / раза в неделю": Russian needs the plural category; the dictionaries carry one/few/many/other. */
function perWeekLabel(t: Translate, locale: Locale, n: number): string {
  const category = new Intl.PluralRules(INTL_LOCALE[locale]).select(n);
  const key = category === "one" || category === "few" || category === "many" ? category : "other";
  return t(`today.perWeek.${key}`, { n });
}
