import PatientReport from "@/components/clinician/PatientReport";
import { patientIds } from "@/lib/clinic/mockData";

export function generateStaticParams() {
  return patientIds().map((id) => ({ id }));
}

export default function ReportPage({ params }: { params: { id: string } }) {
  return <PatientReport id={params.id} />;
}
