// Patient performance + personalised-insight model. A "session" is one completed exercise bout; the
// engine turns a history of sessions into progression facts and personalised insights. Everything is
// derived from real in-session measurements (reach count, reach time, live FoG/HAR readouts) — no
// invented numbers.

export type Exercise = "reaching";
export type Side = "left" | "right";

export interface SessionRecord {
  id: string;
  startedAt: number; // epoch ms
  endedAt: number;
  exercise: Exercise;
  side: Side;
  durationSec: number;
  reaches: number; // targets successfully reached
  attempts: number;
  reachMs: { mean: number; best: number }; // movement-time proxy (spawn -> contact)
  fogRiskMean: number | null; // mean freeze-risk over the bout (arm-derived preview)
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
  streakDays: number;
  weekSessions: number;
  avgReachMs: number | null;
  bestReachMs: number | null;
  reachTrendPct: number | null; // negative = faster (improving)
}
