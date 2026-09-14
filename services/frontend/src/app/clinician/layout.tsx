import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import ClinicHeader from "@/components/clinician/ClinicHeader";
import { createClient } from "@/lib/supabase/server";

const CLINICIAN_ROLES = ["clinician", "clinic_admin", "admin"];

export default async function ClinicianLayout({ children }: { children: ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin?next=/clinician");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !CLINICIAN_ROLES.includes(profile.role)) {
    redirect("/app");
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <ClinicHeader />
      {children}
    </div>
  );
}
