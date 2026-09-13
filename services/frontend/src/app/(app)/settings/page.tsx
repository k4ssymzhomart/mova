// Settings (/settings), the footer utility «Настройки». The server reads what the page needs and
// SettingsClient renders it. Every query is filtered to the signed-in user or their patient record instead of
// relying on RLS to scope rows, because the policies are being reworked (#20).
//
// This page does not call provision_self_serve_patient: opening settings should not create records. Sign-in
// already provisions (auth/callback). A user without a patient record has no sessions to export.
//
// care_team_links is not read here. Under 0022 the links do not decide who can see a patient (the clinic RPCs
// return every patient in the caller's clinic), so a count of linked clinicians would mislead.

import type { Metadata } from "next";

import { getPatientContext } from "@/lib/patient/context";
import { createClient } from "@/lib/supabase/server";
import { getTranslation } from "@/locales/server";

import SettingsClient from "./SettingsClient";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = getTranslation();
  return { title: `${t("settings.metaTitle")} · Mova` };
}

export default async function SettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // layout redirects unauth; guard the race so we never deref a null user

  const [profileRes, patientRes, context] = await Promise.all([
    supabase.from("profiles").select("full_name, display_name").eq("id", user.id).maybeSingle(),
    supabase.from("patients").select("id").eq("profile_id", user.id).maybeSingle(),
    // React-cached per request: the layout already resolved it, so this is not a second round trip.
    getPatientContext(user.id),
  ]);

  return (
    <SettingsClient
      userId={user.id}
      patientId={patientRes.data?.id ?? null}
      email={user.email ?? ""}
      // A failed read must not look like an empty name: saving would then wipe the stored one.
      profileLoaded={!profileRes.error}
      fullName={profileRes.data?.full_name ?? ""}
      displayName={profileRes.data?.display_name ?? ""}
      side={context.side}
    />
  );
}
