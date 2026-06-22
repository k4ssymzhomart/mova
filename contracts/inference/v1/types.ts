// Typed inference contract (v1) — TypeScript side (Supabase Edge Functions + frontend).
// Mirrors contracts/inference/v1/inference.schema.json (the source of truth).
// PRIVACY: derived IMU windows + pose keypoints + metrics only — never raw video.

export const CONTRACT_VERSION = "1.0" as const;
export const N_CHANNELS = 6; // acc xyz + gyro xyz

export type InferenceTask =
  | "fog"
  | "har"
  | "movement_quality"
  | "joint_angle"
  | "pose";

export type BodySite =
  | "pelvis" | "lower_back" | "sternum" | "head"
  | "l_upperarm" | "r_upperarm" | "l_wrist" | "r_wrist"
  | "l_thigh" | "r_thigh" | "l_shank" | "r_shank" | "l_foot" | "r_foot"
  | "unspecified";

/** A single IMU window: samples is [T, 6] = acc(xyz) + gyro(xyz). */
export interface ImuWindow {
  start_ts?: string;
  samples: number[][];
}

export interface InferenceRequest {
  contract_version: typeof CONTRACT_VERSION;
  task: InferenceTask;
  patient_id: string;
  clinic_id: string;
  session_id?: string;
  sampling_rate_hz?: number; // default 50
  placement?: BodySite; // default "unspecified"
  windows: ImuWindow[];
  model_version?: string | null;
  idempotency_key?: string | null;
}

export interface FogPrediction {
  is_fog: boolean;
  confidence: number;
  timestamp: string;
  freeze_index?: number | null;
}

export interface HarPrediction {
  label: string;
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface QualityPrediction {
  quality_score: number;
  smoothness?: number | null;
  symmetry?: number | null;
  compensation_flags?: Record<string, boolean>;
}

export interface JointAnglePrediction {
  angles: Record<string, number>;
  mpjae_deg?: number | null;
}

export interface Prediction {
  window_index: number;
  fog?: FogPrediction;
  har?: HarPrediction;
  movement_quality?: QualityPrediction;
  joint_angle?: JointAnglePrediction;
}

export interface InferenceResponse {
  contract_version: typeof CONTRACT_VERSION;
  task: InferenceTask;
  model: { name: string; version: string; source: string };
  predictions: Prediction[];
  summary?: Record<string, number>;
  latency_ms?: number;
  generated_at: string;
}
