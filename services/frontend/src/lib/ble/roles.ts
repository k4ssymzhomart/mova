/**
 * A physical WT901BLE68 sensor is bound to one of three body-site roles for a
 * rehab session -- always by explicit patient choice at pairing time, never
 * inferred from BLE discovery order (see the Phoenix audit this was ported
 * from: auto-assigning MAC addresses by discovery order is explicitly banned).
 */
export type SensorRole = "thigh" | "shank" | "foot";

export const SENSOR_ROLE_ORDER: readonly SensorRole[] = ["thigh", "shank", "foot"];

export const SENSOR_ROLE_LABEL: Record<SensorRole, string> = {
  thigh: "Thigh",
  shank: "Shank",
  foot: "Foot",
};

export type Side = "left" | "right";

/**
 * `patient_ble_devices.role` is constrained to the six lateralized values of
 * the existing `body_site` enum (l_thigh/r_thigh/...), not a bare
 * thigh/shank/foot -- this reuses the ontology that already "drives
 * placement-aware sensor handling" elsewhere rather than inventing a second
 * one. `side` must be resolved explicitly (from the patient's affected side,
 * or asked directly for a bilateral/unset patient) before a role can be
 * persisted -- defaulting silently would misassign one of the AC-03 role
 * statuses.
 */
export function bodySiteForRole(role: SensorRole, side: Side): string {
  return `${side === "left" ? "l" : "r"}_${role}`;
}

/** Inverse of {@link bodySiteForRole}; `null` for any value outside the six sensor sites. */
export function roleFromBodySite(bodySite: string): SensorRole | null {
  const match = /^[lr]_(thigh|shank|foot)$/.exec(bodySite);
  return match ? (match[1] as SensorRole) : null;
}
