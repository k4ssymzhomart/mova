import Link from "next/link";

import { pageTitle } from "@/components/app/recipes";
import HeelSlideResult from "@/components/clinician/HeelSlideResult";
import PatientDetail from "@/components/clinician/PatientDetail";
import { loadHeelSlideSection } from "@/lib/clinic/heelSlideResult";
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
  const [patient, heelSlide] = await Promise.all([
    fetchPatient(params.id),
    loadHeelSlideSection(params.id, requested),
  ]);
  const section = heelSlide.kind === "none" ? null : <HeelSlideResult section={heelSlide} />;

  if (section && (heelSlide.kind === "ok" || !patient)) {
    const { t } = getTranslation();
    const name = (heelSlide.kind === "ok" ? heelSlide.view.patientName : null) ?? patient?.demo.name ?? null;
    return (
      <main className="mx-auto max-w-shell space-y-6 px-5 py-8 sm:px-8">
        <Link href="/clinician" className="inline-block text-sm text-ink-soft transition-colors hover:text-ink">
          {t("common.backToCaseload")}
        </Link>
        <h1 className={pageTitle}>{name ?? t("clinician.heelSlide.patientHeading")}</h1>
        {section}
      </main>
    );
  }

  if (!patient) {
    const { t } = getTranslation();
    return (
      <main className="mx-auto max-w-shell px-5 py-16 sm:px-8">
        <p className="text-ink-soft">{t("clinician.detail.notFound")}</p>
        <Link href="/clinician" className="mt-4 inline-block text-sm text-signal-deep hover:underline">
          {t("common.backToCaseload")}
        </Link>
      </main>
    );
  }

  return <PatientDetail patient={patient} resultSlot={section} />;
}
