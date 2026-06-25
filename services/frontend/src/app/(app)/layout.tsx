import { redirect } from "next/navigation";

import AppShell from "@/components/layout/AppShell";
import { createClient } from "@/lib/supabase/server";

/**
 * Shared layout for the authenticated patient app. Gates the whole group server-side (so the SSR
 * pages under /app are safe to assume a user) and wraps every route in the persistent AppShell.
 */
export default async function PatientAppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin?next=/app");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, display_name")
    .eq("id", user.id)
    .maybeSingle();

  const name =
    profile?.display_name || profile?.full_name || user.email?.split("@")[0] || "Patient";

  return (
    <AppShell name={name} email={user.email ?? ""}>
      {children}
    </AppShell>
  );
}
