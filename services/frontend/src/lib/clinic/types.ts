// Clinician-domain types. The portal deliberately reuses the patient-side domain — PatientProfile
// (condition / affected side / baseline ROM) and SessionRecord (the bout history the insight engine
// already understands) — and layers on the clinical wrapper a therapist works with: demographics, a
// prescription, and derived caseload metrics. One source of truth across both halves of the marketplace.

import type { SessionRecord } from "@/lib/insights/types";
import type { Pack, PatientProfile } from "@/lib/profile/types";

export interface Demographics {
  name: string;
  age: number;
  mrn: string; // medical record number (mock)
}

export interface Prescription {
  pack: Pack;
  weeklyDoseSessions: number; // prescribed sessions / week
  targetCadenceSpm: number; // gait cadence target
  difficulty: number; // 0..1 game difficulty
  note: string;
  updatedAt: number;
}

export interface ClinicPatient {
  demo: Demographics;
  profile: PatientProfile;
  sessions: SessionRecord[];
  prescription: Prescription;
  lastActiveAt: number;
}

export type RiskSeverity = "high" | "watch" | "info";

export interface RiskFlag {
  id: string;
  label: string;
  severity: RiskSeverity;
  detail: string;
}

export interface CaseMetrics {
  adherencePct: number; // weekSessions vs prescribed dose, 0..100
  weekSessions: number;
  totalSessions: number;
  streakDays: number;
  lastActiveAt: number;
  flags: RiskFlag[];
}
