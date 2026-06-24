import PatientDetail from "@/components/clinician/PatientDetail";
import { patientIds } from "@/lib/clinic/mockData";

// Prerender one static page per mock patient. When a real backend lands, this becomes a server fetch.
export function generateStaticParams() {
  return patientIds().map((id) => ({ id }));
}

export default function PatientPage({ params }: { params: { id: string } }) {
  return <PatientDetail id={params.id} />;
}
