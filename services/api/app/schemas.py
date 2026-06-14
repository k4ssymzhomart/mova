"""Request/response contracts for the prediction API."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

N_CHANNELS = 6  # acc xyz + gyro xyz


class FogWindow(BaseModel):
    """A raw IMU window: ``window`` is [T, 6] (acc xyz + gyro xyz)."""

    window: list[list[float]] = Field(..., description="[T,6] acc(xyz)+gyro(xyz) samples")
    sampling_rate: float = Field(50.0, gt=0, description="Hz")
    session_id: str | None = None

    @field_validator("window")
    @classmethod
    def _check_shape(cls, v: list[list[float]]) -> list[list[float]]:
        if not v:
            raise ValueError("window must be non-empty")
        widths = {len(row) for row in v}
        if widths != {N_CHANNELS}:
            raise ValueError(
                f"every row must have {N_CHANNELS} channels; got widths {sorted(widths)}"
            )
        return v


class FogPrediction(BaseModel):
    """The prediction payload (identical shape for mock and real model)."""

    is_fog: bool
    confidence: float
    timestamp: str
    freeze_index: float | None = None
    source: str = "mock-bachlin-freeze-index"
