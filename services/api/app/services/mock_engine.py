"""Deterministic fallback FoG detector — Bachlin et al. (2010) Freeze Index.

Used while the trained model is not yet served from the GPU cluster. It computes the ratio of spectral
power in the freeze band (3-8 Hz) to the locomotor band (0.5-3 Hz) of the acceleration magnitude:
a high ratio together with enough movement energy => freezing of gait. The return payload is the exact
shape the real model endpoint will produce, so clients need zero changes when we swap engines.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import numpy as np

LOCO_BAND = (0.5, 3.0)
FREEZE_BAND = (3.0, 8.0)
FI_THRESHOLD = 1.5
POWER_THRESHOLD = 1e-3  # g^2; below this the subject is essentially still (not freezing)
N_CHANNELS = 6


def _band_power(freqs: np.ndarray, psd: np.ndarray, lo: float, hi: float) -> float:
    return float(psd[(freqs >= lo) & (freqs < hi)].sum())


def predict_fog(
    window: list[list[float]] | np.ndarray,
    sampling_rate: float = 50.0,
    *,
    fi_threshold: float = FI_THRESHOLD,
    power_threshold: float = POWER_THRESHOLD,
) -> dict[str, Any]:
    arr = np.asarray(window, dtype=np.float64)
    if arr.ndim != 2:
        raise ValueError("window must be 2-D [T, 6]")
    if arr.shape[1] != N_CHANNELS and arr.shape[0] == N_CHANNELS:
        arr = arr.T  # accept channels-first [6, T]
    if arr.shape[1] < N_CHANNELS:
        raise ValueError(f"expected {N_CHANNELS} channels, got shape {arr.shape}")

    sig = np.linalg.norm(arr[:, :3], axis=1)  # acceleration magnitude
    sig = sig - sig.mean()
    n = sig.shape[0]

    freeze_index = 0.0
    total_power = 0.0
    if n >= 8 and sampling_rate > 0:
        psd = (np.abs(np.fft.rfft(sig * np.hanning(n))) ** 2) / n
        freqs = np.fft.rfftfreq(n, d=1.0 / sampling_rate)
        loco = _band_power(freqs, psd, *LOCO_BAND)
        freeze = _band_power(freqs, psd, *FREEZE_BAND)
        total_power = loco + freeze
        freeze_index = freeze / (loco + 1e-9)

    moving = total_power > power_threshold
    is_fog = bool(moving and freeze_index > fi_threshold)
    conf = 1.0 / (1.0 + np.exp(-2.0 * (freeze_index - fi_threshold)))
    if not moving:
        conf *= 0.5
    confidence = float(np.clip(conf, 0.0, 1.0))

    return {
        "is_fog": is_fog,
        "confidence": round(confidence, 4),
        "timestamp": datetime.now(UTC).isoformat(),
        "freeze_index": round(float(freeze_index), 4),
        "source": "mock-bachlin-freeze-index",
    }
