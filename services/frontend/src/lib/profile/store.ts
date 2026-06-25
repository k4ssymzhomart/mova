"use client";

// Local, on-device patient-profile store. Same privacy posture as the session store: nothing leaves the
// device. The shape matches the eventual Supabase `patients` row so swapping the backend later is a
// drop-in. Also holds the pure mapping logic: condition -> recommended pack, and baseline ROM -> in-game
// difficulty / starting cadence, so /session can personalise itself.

import type { AffectedSide, Condition, Pack, PatientProfile, RomBaseline, SidePair } from "./types";

const BASE = "mova.profile.v1";

/** Per-user storage key; falls back to a shared guest bucket when there is no signed-in user. */
function keyFor(userId?: string | null): string {
  return userId ? `${BASE}::${userId}` : `${BASE}::guest`;
}

export function loadProfile(userId?: string | null): PatientProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    return raw ? (JSON.parse(raw) as PatientProfile) : null;
  } catch {
    return null;
  }
}

export function saveProfile(p: PatientProfile, userId?: string | null): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(keyFor(userId), JSON.stringify({ ...p, updatedAt: Date.now() }));
}

export function clearProfile(userId?: string | null): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(keyFor(userId));
}

export function makeProfileId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Map a condition to the exercise pack with the strongest evidence base for it. */
export function packForCondition(condition: Condition): Pack {
  // Parkinson's -> gait/balance (matches the FoG model); stroke & ortho start on upper-limb reaching.
  return condition === "parkinsons" ? "gait" : "reaching";
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** The limiting limb's value for the affected side (bilateral = the weaker side). */
function affectedValue(pair: SidePair, side: AffectedSide): number {
  if (side === "left") return pair.left;
  if (side === "right") return pair.right;
  return Math.min(pair.left, pair.right);
}

/**
 * Ability for a mode, 0..1, from the baseline ROM of the affected limb. Higher ability -> the game can
 * present a harder target. No baseline -> a neutral 0.5 so an un-onboarded patient still gets a sane game.
 */
export function abilityFor(profile: PatientProfile | null, mode: "reach" | "gait"): number {
  const b = profile?.baseline;
  if (!b) return 0.5;
  if (mode === "reach") {
    const v = affectedValue(b.armElevationDeg, profile!.affectedSide);
    return clamp01((v - 50) / (160 - 50)); // ~50° (very limited) .. ~160° (full overhead)
  }
  const v = affectedValue(b.kneeRaiseDeg, profile!.affectedSide);
  return clamp01((v - 10) / (90 - 10)); // ~10° (minimal) .. ~90° (high march)
}

/** Starting cadence (spm) seeded from gait ability — lower ROM begins gentler. */
export function startingCadence(profile: PatientProfile | null): number {
  return Math.round(55 + 25 * abilityFor(profile, "gait")); // 55..80 spm
}

/** Assemble a fresh profile from the intake answers. */
export function buildProfile(
  condition: Condition,
  affectedSide: AffectedSide,
  baseline: RomBaseline | null,
): PatientProfile {
  const now = Date.now();
  return {
    id: makeProfileId(),
    createdAt: now,
    updatedAt: now,
    condition,
    affectedSide,
    recommendedPack: packForCondition(condition),
    baseline,
  };
}
