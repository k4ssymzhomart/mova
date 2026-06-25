import Link from "next/link";

import PatientReport from "@/components/clinician/PatientReport";
import { fetchPatient } from "@/lib/clinic/realData";
import { getTranslation } from "@/locales/server";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: { id: string } }) {
  const patient = await fetchPatient(params.id);
  if (!patient) {
    const { t } = getTranslation();
    return (
      <main className="mx-auto max-w-2xl px-5 py-16">
        <p className="text-ink-soft">{t("clinician.detail.notFound")}</p>
        <Link href="/clinician" className="mt-4 inline-block text-sm text-signal-deep hover:underline">
          {t("common.backToCaseload")}
        </Link>
      </main>
    );
  }
  return <PatientReport patient={patient} />;
}
