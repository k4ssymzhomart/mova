// Deterministic mock caseload. Pure + isomorphic (no window, no client imports) so it can seed both
// the build-time route params and the client render. Session histories are fabricated in the real
// SessionRecord shape, so every downstream view runs the *same* summarize()/insight engine the patient
// app uses — the mock is data, not a parallel code path.

import type { SessionRecord, Side } from "@/lib/insights/types";
import type { AffectedSide, Condition, Pack, PatientProfile, RomBaseline } from "@/lib/profile/types";

import type { ClinicPatient, Prescription } from "./types";

const DAY = 86_400_000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const packFor = (c: Condition): Pack => (c === "parkinsons" ? "gait" : "reaching");

/** mulberry32 — tiny deterministic PRNG so the roster is identical every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fogSeries(r: () => number, mean: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 24; k += 1) out.push(Math.round(clamp(mean + (r() - 0.5) * 0.28, 0.02, 0.98) * 1000) / 1000);
  return out;
}

type Trend = "improving" | "plateau" | "declining";

interface GenOpts {
  exercise: "reaching" | "gait";
  n: number;
  side: Side;
  endDaysAgo: number; // most-recent bout
  spanDays: number; // history depth
  trend: Trend;
  fogBase: number | null;
}

function makeSessions(seed: number, o: GenOpts): SessionRecord[] {
  const r = rng(seed);
  const now = Date.now();
  const out: SessionRecord[] = [];
  for (let i = 0; i < o.n; i += 1) {
    const frac = o.n > 1 ? i / (o.n - 1) : 1; // 0 (oldest) .. 1 (newest)
    const daysAgo = o.endDaysAgo + (1 - frac) * o.spanDays + r() * 0.4;
    const startedAt = now - daysAgo * DAY;
    const durationSec = 120 + Math.round(r() * 200);
    const t = o.trend === "improving" ? frac : o.trend === "declining" ? 1 - frac : 0.5;

    const base = {
      id: `mock_${seed}_${i}`,
      startedAt,
      endedAt: startedAt + durationSec * 1000,
      side: o.side,
      durationSec,
      inferenceCount: 30 + Math.round(r() * 70),
    };

    if (o.exercise === "gait") {
      const rhythm = clamp(0.45 + 0.42 * t + (r() - 0.5) * 0.1, 0.2, 0.98);
      const cadence = Math.round(58 + 18 * t + (r() - 0.5) * 6);
      const steps = Math.round((cadence / 60) * durationSec * 0.5 * rhythm);
      const beats = Math.round(steps / Math.max(0.3, rhythm));
      const fogMean = clamp((o.fogBase ?? 0.3) - 0.12 * t + (r() - 0.5) * 0.12, 0.03, 0.95);
      out.push({
        ...base,
        exercise: "gait",
        reaches: 0,
        attempts: beats,
        reachMs: { mean: 0, best: 0 },
        gait: { steps, beats, cadenceSpm: cadence, rhythmPct: rhythm, bestStreak: Math.round(steps * 0.3) },
        fogRiskMean: fogMean,
        fogSeries: fogSeries(r, fogMean),
        fogValid: true,
        harTop: "walking",
      });
    } else {
      const mean = Math.round(900 - 330 * t + (r() - 0.5) * 80); // improving -> faster (lower ms)
      const reaches = Math.round(18 + 22 * t + r() * 6);
      out.push({
        ...base,
        exercise: "reaching",
        reaches,
        attempts: reaches + Math.round(r() * 5),
        reachMs: { mean, best: Math.round(mean * (0.7 + r() * 0.1)) },
        fogRiskMean: o.fogBase != null ? clamp(o.fogBase + (r() - 0.5) * 0.1, 0.05, 0.9) : null,
        fogValid: false,
        harTop: r() > 0.5 ? "frontal_elevation_arms" : "lateral_elevation_arms",
      });
    }
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

function profile(
  id: string,
  condition: Condition,
  affectedSide: AffectedSide,
  baseline: RomBaseline | null,
): PatientProfile {
  return {
    id,
    createdAt: Date.now() - 30 * DAY,
    updatedAt: Date.now() - 30 * DAY,
    condition,
    affectedSide,
    recommendedPack: packFor(condition),
    baseline,
  };
}

function baseline(armL: number, armR: number, kneeL: number, kneeR: number): RomBaseline {
  return {
    capturedAt: Date.now() - 30 * DAY,
    armElevationDeg: { left: armL, right: armR },
    kneeRaiseDeg: { left: kneeL, right: kneeR },
    frames: 280,
  };
}

function rx(pack: Pack, weeklyDoseSessions: number, targetCadenceSpm: number, difficulty: number, note: string): Prescription {
  return { pack, weeklyDoseSessions, targetCadenceSpm, difficulty, note, updatedAt: Date.now() - 14 * DAY };
}

// --- the caseload ------------------------------------------------------------------------------------

const ROSTER: ClinicPatient[] = [
  {
    demo: { name: "Aigerim Nurlanqyzy", age: 64, mrn: "MV-10241" },
    profile: profile("p-aigerim", "parkinsons", "right", baseline(118, 96, 58, 40)),
    sessions: makeSessions(101, { exercise: "gait", n: 14, side: "right", endDaysAgo: 1, spanDays: 19, trend: "improving", fogBase: 0.66 }),
    prescription: rx("gait", 5, 64, 0.4, "Cueing-led gait. Watch freeze episodes; keep cadence comfortable."),
    lastActiveAt: Date.now() - 1 * DAY,
  },
  {
    demo: { name: "Daniyar Qazybek", age: 57, mrn: "MV-10288" },
    profile: profile("p-daniyar", "stroke", "left", baseline(72, 150, 60, 70)),
    sessions: makeSessions(202, { exercise: "reaching", n: 18, side: "left", endDaysAgo: 0, spanDays: 20, trend: "improving", fogBase: null }),
    prescription: rx("reaching", 6, 67, 0.5, "Left-sided reaching, progressive ROM. Strong adherence — advance difficulty."),
    lastActiveAt: Date.now() - 6 * 3600e3,
  },
  {
    demo: { name: "Marbek Sultan", age: 49, mrn: "MV-10310" },
    profile: profile("p-marbek", "ortho", "right", baseline(150, 104, 72, 66)),
    sessions: makeSessions(303, { exercise: "reaching", n: 7, side: "right", endDaysAgo: 9, spanDays: 16, trend: "plateau", fogBase: null }),
    prescription: rx("reaching", 5, 67, 0.6, "Post-op shoulder. Plateauing — re-engage; consider tele-visit."),
    lastActiveAt: Date.now() - 9 * DAY,
  },
  {
    demo: { name: "Gulnara Toleu", age: 71, mrn: "MV-10355" },
    profile: profile("p-gulnara", "parkinsons", "bilateral", baseline(102, 98, 36, 34)),
    sessions: makeSessions(404, { exercise: "gait", n: 16, side: "right", endDaysAgo: 2, spanDays: 20, trend: "declining", fogBase: 0.64 }),
    prescription: rx("gait", 5, 60, 0.35, "Bilateral, high fall risk. Declining rhythm — review medication timing."),
    lastActiveAt: Date.now() - 2 * DAY,
  },
  {
    demo: { name: "Yerlan Bekov", age: 60, mrn: "MV-10377" },
    profile: profile("p-yerlan", "stroke", "right", baseline(96, 88, 64, 58)),
    sessions: makeSessions(505, { exercise: "reaching", n: 20, side: "right", endDaysAgo: 0, spanDays: 19, trend: "improving", fogBase: null }),
    prescription: rx("reaching", 6, 67, 0.55, "Excellent streak. Maintain; begin bilateral integration next block."),
    lastActiveAt: Date.now() - 3 * 3600e3,
  },
  {
    demo: { name: "Saule Mukhtar", age: 45, mrn: "MV-10402" },
    profile: profile("p-saule", "ortho", "left", null),
    sessions: makeSessions(606, { exercise: "reaching", n: 3, side: "left", endDaysAgo: 1, spanDays: 4, trend: "plateau", fogBase: null }),
    prescription: rx("reaching", 4, 67, 0.45, "New patient — baseline ROM not yet captured. Prompt calibration."),
    lastActiveAt: Date.now() - 1 * DAY,
  },
];

export function getRoster(): ClinicPatient[] {
  return ROSTER;
}

export function getPatient(id: string): ClinicPatient | null {
  return ROSTER.find((p) => p.profile.id === id) ?? null;
}

export function patientIds(): string[] {
  return ROSTER.map((p) => p.profile.id);
}
