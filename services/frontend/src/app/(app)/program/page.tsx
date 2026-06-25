import type { Metadata } from "next";
import { ClipboardList } from "lucide-react";

import ComingSoon from "@/components/layout/ComingSoon";

export const metadata: Metadata = { title: "My Program · Mova" };

export default function ProgramPage() {
  return (
    <ComingSoon
      icon={ClipboardList}
      title="My Program"
      description="Your prescribed plan — weekly schedule, goals per joint, the exercise list with status, expected dose, and your clinician's note."
    />
  );
}
