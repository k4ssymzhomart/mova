import type { ReactNode } from "react";

import RequireAuth from "@/components/auth/RequireAuth";
import ClinicHeader from "@/components/clinician/ClinicHeader";

export default function ClinicianLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="min-h-screen bg-paper text-ink">
        <ClinicHeader />
        {children}
      </div>
    </RequireAuth>
  );
}
