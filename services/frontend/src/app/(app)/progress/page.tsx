import type { Metadata } from "next";

import { loadRealSessions } from "@/lib/insights/realStore";

import ProgressClient from "./ProgressClient";

export const metadata: Metadata = { title: "Progress · Mova" };

// Server wrapper: reads the signed-in patient's real, Supabase-backed session history
// (patient_session_history, self-scoped to the caller) instead of an on-device localStorage mirror.
export default async function ProgressPage() {
  const sessions = await loadRealSessions();
  return <ProgressClient sessions={sessions} />;
}
