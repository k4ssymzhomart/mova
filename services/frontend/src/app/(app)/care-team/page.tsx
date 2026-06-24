import type { Metadata } from "next";
import { Users } from "lucide-react";

import ComingSoon from "@/components/layout/ComingSoon";

export const metadata: Metadata = { title: "Care Team · Mova" };

export default function CareTeamPage() {
  return (
    <ComingSoon
      icon={Users}
      title="Care Team"
      description="Message your clinician, see scheduled video visits, review shared notes, and manage your consent status."
    />
  );
}
