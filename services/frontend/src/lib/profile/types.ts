// Patient profile — the personalization record produced by the intake flow. Kept local (localStorage)
// for now, but shaped to drop into the eventual Supabase `patients` / `prescriptions` rows. The baseline
// ROM seeds in-game difficulty; the condition picks the recommended exercise pack.

export type Condition = "stroke" | "parkinsons" | "ortho";
export type AffectedSide = "left" | "right" | "bilateral";
export type Pack = "reaching" | "gait";

export interface SidePair {
  left: number;
  right: number;
}

export interface RomBaseline {
  capturedAt: number;
  armElevationDeg: SidePair; // max comfortable shoulder elevation per side
  kneeRaiseDeg: SidePair; // max comfortable knee raise per side
  frames: number; // how many tracked frames fed the capture (a confidence proxy)
}

export interface PatientProfile {
  id: string;
  createdAt: number;
  updatedAt: number;
  condition: Condition;
  affectedSide: AffectedSide;
  recommendedPack: Pack;
  baseline: RomBaseline | null;
}
