"""Windowing: 50 Hz aligned streams -> fixed 4 s (200-sample) windows with aggregated labels.

Overlap is task-dependent (set by the caller): 50% for generic HAR, 75% for Daphnet so that short
freezing-of-gait events are not missed.
"""

from __future__ import annotations

from collections.abc import Iterator

import numpy as np

WINDOW = 200  # 4 s @ 50 Hz


def window_starts(n: int, win: int, stride: int) -> range:
    if n < win:
        return range(0)
    return range(0, n - win + 1, stride)


def iter_windows(
    x: np.ndarray, act: np.ndarray, fog: np.ndarray, win: int, stride: int
) -> Iterator[tuple[int, np.ndarray, np.ndarray, np.ndarray]]:
    for s in window_starts(x.shape[0], win, stride):
        yield s, x[s : s + win], act[s : s + win], fog[s : s + win]


def aggregate_har(act_codes: np.ndarray) -> tuple[int, float]:
    """Majority activity code over a window + label purity (fraction of the majority)."""
    valid = act_codes[act_codes >= 0]
    if valid.size == 0:
        return -1, 0.0
    vals, counts = np.unique(valid, return_counts=True)
    j = int(counts.argmax())
    return int(vals[j]), float(counts[j] / act_codes.size)


def aggregate_fog(fog_codes: np.ndarray, min_valid_frac: float = 0.5) -> int | None:
    """Window-level FoG: 1 freeze / 0 no-freeze, or None if mostly out-of-experiment (label 0)."""
    valid = fog_codes[(fog_codes == 1) | (fog_codes == 2)]
    if valid.size < min_valid_frac * fog_codes.size:
        return None
    return 1 if (valid == 2).mean() >= 0.5 else 0
