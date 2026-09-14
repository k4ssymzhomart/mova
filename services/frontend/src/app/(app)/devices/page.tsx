import type { Metadata } from "next";

import { roleFromBodySite, type SensorRole } from "@/lib/ble/roles";
import { createClient } from "@/lib/supabase/server";

import DevicesClient from "./DevicesClient";

export const metadata: Metadata = { title: "Devices · Mova" };

export default async function DevicesPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // layout redirects unauth; guard the race so we never deref a null user

  const { data: patient } = await supabase.from("patients").select("id, affected_side").maybeSingle();

  const { data: pairedRows } = patient
    ? await supabase
        .from("patient_ble_devices")
        .select("role, device_name")
        .eq("patient_id", patient.id)
    : { data: null };

  const pairedDeviceNames: Partial<Record<SensorRole, string | null>> = {};
  for (const row of pairedRows ?? []) {
    const role = roleFromBodySite(row.role as string);
    if (role) pairedDeviceNames[role] = row.device_name as string | null;
  }

  const affectedSide = patient?.affected_side as string | null;

  return (
    <DevicesClient
      patientId={patient?.id ?? null}
      affectedSide={affectedSide === "left" || affectedSide === "right" ? affectedSide : null}
      pairedDeviceNames={pairedDeviceNames}
    />
  );
}
