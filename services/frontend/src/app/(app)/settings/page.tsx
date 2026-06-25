import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";

import SettingsClient from "./SettingsClient";

export const metadata: Metadata = { title: "Settings · Mova" };

export default async function SettingsPage() {
  const supabase = createClient();
  await supabase.rpc("provision_self_serve_patient");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // layout redirects unauth; guard the race so we never deref a null user

  const [{ data: profile }, { data: patient }, { data: careLinks }] = await Promise.all([
    supabase.from("profiles").select("full_name, display_name, locale").eq("id", user!.id).maybeSingle(),
    supabase.from("patients").select("affected_side").maybeSingle(),
    supabase.from("care_team_links").select("id").eq("is_active", true),
  ]);

  return (
    <SettingsClient
      userId={user!.id}
      email={user!.email ?? ""}
      fullName={profile?.full_name ?? ""}
      displayName={profile?.display_name ?? ""}
      locale={(profile?.locale as "en" | "ru" | "kk") ?? "en"}
      affectedSide={(patient?.affected_side as string) ?? "none"}
      activeCareLinks={(careLinks ?? []).length}
    />
  );
}
