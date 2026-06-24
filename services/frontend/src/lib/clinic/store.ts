"use client";

// Clinician prescription overrides. The mock roster ships a default prescription per patient; when a
// therapist edits one in the portal it persists here (localStorage), keyed by patient id, and the portal
// reads the override back. This is the seam where a real backend write (Supabase `prescriptions`) drops
// in later — the UI already speaks Prescription.

import type { Prescription } from "./types";

const KEY = "mova.clinic.rx.v1";

type RxMap = Record<string, Prescription>;

function readMap(): RxMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as RxMap;
  } catch {
    return {};
  }
}

export function loadPrescription(patientId: string): Prescription | null {
  return readMap()[patientId] ?? null;
}

export function savePrescription(patientId: string, rx: Prescription): void {
  if (typeof window === "undefined") return;
  const map = readMap();
  map[patientId] = { ...rx, updatedAt: Date.now() };
  window.localStorage.setItem(KEY, JSON.stringify(map));
}
