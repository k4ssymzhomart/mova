import Link from "next/link";

import { pageFlow, pageTitle } from "@/components/app/recipes";
import AssignExercises from "@/components/clinician/AssignExercises";
import HeelSlideResult from "@/components/clinician/HeelSlideResult";
import PatientDetail from "@/components/clinician/PatientDetail";
import PatientProgressPanel from "@/components/clinician/PatientProgressPanel";
import { loadHeelSlideSection } from "@/lib/clinic/heelSlideResult";
import { loadPatientPlan } from "@/lib/clinic/patientPlan";
import { loadPatientProgress } from "@/lib/clinic/patientProgress";
import { fetchPatient } from "@/lib/clinic/realData";
import { getTranslation } from "@/locales/server";

export const dynamic = "force-dynamic";

// The Heel Slide result renders inside the page's main landmark, right after the patient's h1. It is authorized on
// its own (care-team link, clinic admin or platform admin, via the 0034 review RPCs), so a linked clinician from
// another clinic can see it even when the clinic-scoped overview finds no patient.
//
// A patient with Heel Slide sessions gets only that view. The older PatientDetail panels below it were built for the
// camera-era stroke and Parkinson's app: they would label a knee patient with a stroke condition, a reaching pack, a
// cadence target and freezing-of-gait episodes, none of which describe this patient. Every other patient keeps
// PatientDetail as before.
export default async function PatientPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const requested = typeof searchParams.session === "string" ? searchParams.session : undefined;
  // params.id is the patients.id the caseload links to; every loader below is authorised on it in the database.
  const [patient, heelSlide, plan, progress] = await Promise.all([
    fetchPatient(params.id),
    loadHeelSlideSection(params.id, requested),
    loadPatientPlan(params.id),
    loadPatientProgress(params.id),
  ]);
  const { t, locale } = getTranslation();
  const section = heelSlide.kind === "none" ? null : <HeelSlideResult section={heelSlide} />;

  // What the patient has done, and what they are asked to do. Both are shown whenever the clinician may see this
  // patient at all, whether or not there is a Heel Slide session to render above them.
  const panels = (
    <>
      {progress.status === "ok" ? (
        <PatientProgressPanel sessions={progress.sessions} trend={progress.trend} />
      ) : (
        <p className="max-w-measure text-base text-ink-soft">{t("clinician.progress.readFailed")}</p>
      )}
      {plan.status === "ok" ? (
        <AssignExercises patientId={params.id} rows={plan.rows} locale={locale} />
      ) : (
        <p className="max-w-measure text-base text-ink-soft">{t("clinician.assign.readFailed")}</p>
      )}
    </>
  );

  if (patient || heelSlide.kind !== "none") {
    const name = (heelSlide.kind === "ok" ? heelSlide.view.patientName : null) ?? patient?.demo.name ?? null;
    return (
      <main className={`${pageFlow} mx-auto max-w-app px-5 py-8 sm:px-8`}>
        <div>
          <Link href="/clinician" className="inline-block text-sm text-ink-soft transition-colors hover:text-ink">
            {t("common.backToCaseload")}
          </Link>
          <h1 className={`mt-2 ${pageTitle}`}>{name ?? t("clinician.heelSlide.patientHeading")}</h1>
        </div>
        {section}
        {panels}
      </main>
    );
  }

  if (!patient) {
    return (
      <main className="mx-auto max-w-app px-5 py-16 sm:px-8">
        <p className="text-ink-soft">{t("clinician.detail.notFound")}</p>
        <Link href="/clinician" className="mt-4 inline-block text-sm text-signal-deep hover:underline">
          {t("common.backToCaseload")}
        </Link>
      </main>
    );
  }

  return <PatientDetail patient={patient} resultSlot={section} />;
}
