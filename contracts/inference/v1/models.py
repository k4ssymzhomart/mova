"""Typed inference contract (v1) — Python side.

The Supabase backend and the Python inference service exchange these payloads. They
mirror contracts/inference/v1/inference.schema.json (the source of truth) and stay
backward-compatible with services/api/app/schemas.py (FogWindow / FogPrediction).

PRIVACY: these carry derived IMU windows + pose keypoints + metrics only — never raw video.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field, field_validator

CONTRACT_VERSION = "1.0"
N_CHANNELS = 6  # acc xyz + gyro xyz


class InferenceTask(str, Enum):
    fog = "fog"
    har = "har"
    movement_quality = "movement_quality"
    joint_angle = "joint_angle"
    pose = "pose"


class BodySite(str, Enum):
    pelvis = "pelvis"
    lower_back = "lower_back"
    sternum = "sternum"
    head = "head"
    l_upperarm = "l_upperarm"
    r_upperarm = "r_upperarm"
    l_wrist = "l_wrist"
    r_wrist = "r_wrist"
    l_thigh = "l_thigh"
    r_thigh = "r_thigh"
    l_shank = "l_shank"
    r_shank = "r_shank"
    l_foot = "l_foot"
    r_foot = "r_foot"
    unspecified = "unspecified"


class ImuWindow(BaseModel):
    """A single IMU window: ``samples`` is [T, 6] (acc xyz + gyro xyz)."""

    start_ts: str | None = None
    samples: list[list[float]] = Field(..., description="[T,6] acc(xyz)+gyro(xyz)")

    @field_validator("samples")
    @classmethod
    def _check_shape(cls, v: list[list[float]]) -> list[list[float]]:
        if not v:
            raise ValueError("samples must be non-empty")
        widths = {len(row) for row in v}
        if widths != {N_CHANNELS}:
            raise ValueError(f"every row must have {N_CHANNELS} channels; got {sorted(widths)}")
        return v


class InferenceRequest(BaseModel):
    contract_version: str = CONTRACT_VERSION
    task: InferenceTask
    patient_id: str
    clinic_id: str
    session_id: str | None = None
    sampling_rate_hz: float = Field(50.0, gt=0)
    placement: BodySite = BodySite.unspecified
    windows: list[ImuWindow]
    model_version: str | None = None
    idempotency_key: str | None = None


class FogPrediction(BaseModel):
    is_fog: bool
    confidence: float = Field(..., ge=0, le=1)
    timestamp: str
    freeze_index: float | None = None


class HarPrediction(BaseModel):
    label: str
    confidence: float = Field(..., ge=0, le=1)
    probabilities: dict[str, float] | None = None


class QualityPrediction(BaseModel):
    quality_score: float
    smoothness: float | None = None
    symmetry: float | None = None
    compensation_flags: dict[str, bool] | None = None


class JointAnglePrediction(BaseModel):
    angles: dict[str, float]
    mpjae_deg: float | None = None


class Prediction(BaseModel):
    window_index: int = Field(..., ge=0)
    fog: FogPrediction | None = None
    har: HarPrediction | None = None
    movement_quality: QualityPrediction | None = None
    joint_angle: JointAnglePrediction | None = None


class ModelRef(BaseModel):
    name: str
    version: str
    source: str  # registry id, or e.g. 'mock-bachlin-freeze-index'


class InferenceResponse(BaseModel):
    contract_version: str = CONTRACT_VERSION
    task: InferenceTask
    model: ModelRef
    predictions: list[Prediction]
    summary: dict[str, float] | None = None
    latency_ms: float | None = None
    generated_at: str
