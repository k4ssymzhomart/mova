import Link from "next/link";

import PatientDetail from "@/components/clinician/PatientDetail";
import { fetchPatient } from "@/lib/clinic/realData";
import { getTranslation } from "@/locales/server";

export const dynamic = "force-dynamic";

export default async function PatientPage({ params }: { params: { id: string } }) {
  const patient = await fetchPatient(params.id);
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
  return <PatientDetail patient={patient} />;
}
