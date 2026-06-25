import type { Metadata } from "next";

import { createClient } from "@/lib/supabase/server";

import ProgressClient from "./ProgressClient";

export const metadata: Metadata = { title: "Progress · Mova" };

// Server wrapper: resolves the signed-in user so the client reads ONLY this user's on-device history
// (the local store is namespaced by user id — no cross-account bleed).
export default async function ProgressPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return <ProgressClient userId={user?.id ?? ""} />;
}
