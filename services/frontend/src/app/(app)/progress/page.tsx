import type { Metadata } from "next";

import { mapSession, type SessionRow } from "@/lib/insights/fromSupabaseRow";
import type { SessionRecord } from "@/lib/insights/types";
import { createClient } from "@/lib/supabase/server";

import ProgressClient from "./ProgressClient";

export const metadata: Metadata = { title: "Progress · Mova" };

type OneOrMany<T> = T | T[] | null;
function one<T>(v: OneOrMany<T>): T | null {
  return (Array.isArray(v) ? (v[0] ?? null) : v) ?? null;
}

interface MetricsRow {
  reps: number | null;
  quality_score: number | null;
  fog_risk: number | null;
  rom_mean: number | null;
}
interface Row {
  id: string;
  started_at: string;
  ended_at: string | null;
  summary: SessionRow["summary"];
  session_metrics: OneOrMany<MetricsRow>;
}

// Server wrapper: the patient's session history now comes straight from Supabase (the
// real source of truth), not the device-local localStorage mirror -- so /progress shows
// the same history on a fresh browser as on the original device.
export default async function ProgressPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <ProgressClient sessions={[]} />;

  const { data } = await supabase
    .from("sessions")
    .select("id, started_at, ended_at, summary, session_metrics(reps, quality_score, fog_risk, rom_mean)")
    .eq("status", "completed")
    .order("started_at", { ascending: true });

  const rows = (data ?? []) as unknown as Row[];
  const sessions: SessionRecord[] = rows.map((row) =>
    mapSession({
      id: row.id,
      started_at: row.started_at,
      ended_at: row.ended_at,
      summary: row.summary,
      metrics: one(row.session_metrics),
    }),
  );

  return <ProgressClient sessions={sessions} />;
}
