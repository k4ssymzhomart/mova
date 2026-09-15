import { Inter } from "next/font/google";
import { redirect } from "next/navigation";

import TelemetryOutboxRunner from "@/components/flow/TelemetryOutboxRunner";
import AppShell from "@/components/layout/AppShell";
import { getPatientContext } from "@/lib/patient/context";
import { createClient } from "@/lib/supabase/server";
import { getTranslation } from "@/locales/server";

// Inter for the patient app: real weights and full Cyrillic, Kazakh letters included. Electrolize has no
// Cyrillic glyphs, so on the Russian default it never rendered anything but Latin and digits. docs/ia.md.
const inter = Inter({
  subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext"],
  display: "swap",
  variable: "--font-inter-face",
});

/**
 * Shared layout for the authenticated patient app. Gates the whole group server-side (so the SSR pages under
 * it can assume a user), resolves the patient's clinical context once, and wraps every route in AppShell.
 */
export default async function PatientAppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin?next=/app");

  const { t } = getTranslation();
  const [{ data: profile }, context] = await Promise.all([
    supabase.from("profiles").select("full_name, display_name").eq("id", user.id).maybeSingle(),
    getPatientContext(user.id),
  ]);

  const name =
    profile?.display_name || profile?.full_name || user.email?.split("@")[0] || t("shell.patientFallback");

  return (
    <div className={`${inter.variable} app-type`}>
      {/* Sends sensor frames left on this device by an earlier recording, anywhere in the app. Renders nothing. */}
      <TelemetryOutboxRunner />
      <AppShell name={name} context={context}>
        {children}
      </AppShell>
    </div>
  );
}
