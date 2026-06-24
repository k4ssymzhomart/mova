// Patient performance + personalised-insight model. A "session" is one completed exercise bout; the
// engine turns a history of sessions into progression facts and personalised insights. Everything is
// derived from real in-session measurements (reach count, reach time, live FoG/HAR readouts) — no
// invented numbers.

export type Exercise = "reaching" | "gait";
export type Side = "left" | "right";

export interface GaitMetrics {
  steps: number; // cued lifts landed on the beat
  beats: number; // cues issued
  cadenceSpm: number; // measured steps / minute
  rhythmPct: number; // 0..1 — fraction of cues stepped on time
  bestStreak: number;
}

export interface SessionRecord {
  id: string;
  startedAt: number; // epoch ms
  endedAt: number;
  exercise: Exercise;
  side: Side;
  durationSec: number;
  reaches: number; // targets successfully reached (reaching)
  attempts: number;
  reachMs: { mean: number; best: number }; // movement-time proxy (spawn -> contact)
  gait?: GaitMetrics; // present for gait bouts
  fogRiskMean: number | null; // mean freeze-risk over the bout
  fogSeries?: number[]; // downsampled per-bout freeze-risk samples (0..1) for the timeline
  fogValid: boolean; // true when FoG ran on a lower-limb (in-distribution) window
  harTop: string | null; // most-frequent live activity label
  inferenceCount: number;
}

export type InsightTone = "positive" | "neutral" | "watch";

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  body: string;
  metric?: string; // short delta/figure, e.g. "−18%"
  clinical?: string; // honest mapping to a rehab construct
}

export interface ProgressSummary {
  totalSessions: number;
  totalReaches: number;
  totalSteps: number;
  streakDays: number;
  weekSessions: number;
  avgReachMs: number | null;
  bestReachMs: number | null;
  reachTrendPct: number | null; // negative = faster (improving)
  bestCadenceSpm: number | null;
  rhythmTrendPct: number | null; // positive = more on-beat steps (improving)
}
