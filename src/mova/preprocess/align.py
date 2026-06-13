"""Temporal alignment: per (session, placement) canonical rows -> a strict 50 Hz, 6-channel grid.

Each placement yields one ``[T, 6]`` array with channels ``[ax, ay, az, gx, gy, gz]``:
  * REALDISP (modality=imu): acc+gyro already synchronized -> single resample.
  * Daphnet  (modality=acc): accelerometer only -> gyro channels filled with 0.
  * HHAR     (acc + gyr in separate streams/clocks): each resampled to 50 Hz, then stacked.

Resampling uses linear interpolation to the 50 Hz grid, with a polyphase anti-alias filter
(scipy.resample_poly) whenever the native rate exceeds the target (e.g. HHAR phones at 100-200 Hz).
Per-sample labels (activity, fog) are carried onto the grid by nearest-neighbour in time.

Note: HHAR acc/gyro are re-based to t=0 independently per modality in the adapter, so the cross-modality
alignment here is approximate (sub-second) — acceptable for SSL/HAR; documented as a known limitation.
"""

from __future__ import annotations

import numpy as np
import polars as pl
from scipy.signal import resample_poly

TARGET_HZ = 50.0
ACC_MODS = ("acc", "imu")
GYR_MODS = ("gyr", "imu")
_ACC_CH = ["ax", "ay", "az"]
_GYR_CH = ["gx", "gy", "gz"]


def _clean(x: np.ndarray) -> np.ndarray:
    """Repair non-finite samples (sensor dropout) by per-channel linear interpolation over gaps."""
    x = x.astype(np.float64, copy=True)
    n = x.shape[0]
    idx = np.arange(n)
    for j in range(x.shape[1]):
        col = x[:, j]
        good = np.isfinite(col)
        if good.all():
            continue
        if int(good.sum()) >= 2:
            col[~good] = np.interp(idx[~good], idx[good], col[good])
        else:
            col[:] = 0.0
    return x


def _dedup_sort(
    t: np.ndarray, x: np.ndarray, act: np.ndarray, fog: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    order = np.argsort(t, kind="stable")
    t, x, act, fog = t[order], x[order], act[order], fog[order]
    keep = np.empty(len(t), dtype=bool)
    keep[0] = True
    keep[1:] = np.diff(t) > 0
    return t[keep], x[keep], act[keep], fog[keep]


def _resample(t: np.ndarray, x: np.ndarray) -> tuple[float, np.ndarray] | None:
    """Resample (t, x[n,c]) to the 50 Hz grid. Returns (t0, x_grid[m,c]) or None."""
    duration = float(t[-1] - t[0])
    if duration <= 0 or len(t) < 2:
        return None
    native = (len(t) - 1) / duration
    if native > TARGET_HZ * 1.2:  # downsample with anti-aliasing
        nn = max(1, round(native))
        n_nat = int(duration * nn) + 1
        t_nat = t[0] + np.arange(n_nat) / nn
        x_nat = np.column_stack([np.interp(t_nat, t, x[:, c]) for c in range(x.shape[1])])
        x_grid = resample_poly(x_nat, up=int(TARGET_HZ), down=nn, axis=0)
    else:  # up-sample or near-equal: plain linear interpolation
        n_out = int(duration * TARGET_HZ) + 1
        t_grid = t[0] + np.arange(n_out) / TARGET_HZ
        x_grid = np.column_stack([np.interp(t_grid, t, x[:, c]) for c in range(x.shape[1])])
    return float(t[0]), x_grid.astype(np.float32)


def _fit_length(arr: np.ndarray, n: int) -> np.ndarray:
    m = arr.shape[0]
    if m == n:
        return arr
    if m > n:
        return arr[:n]
    out = np.zeros((n, arr.shape[1]), dtype=arr.dtype)
    out[:m] = arr
    return out


def _labels_to_grid(t_src: np.ndarray, codes: np.ndarray, t0: float, n: int) -> np.ndarray:
    """Nearest-neighbour mapping of per-sample labels onto the 50 Hz grid."""
    tg = t0 + np.arange(n) / TARGET_HZ
    idx = np.clip(np.searchsorted(t_src, tg), 1, len(t_src) - 1)
    pick_left = (tg - t_src[idx - 1]) <= (t_src[idx] - tg)
    nn = np.where(pick_left, idx - 1, idx)
    return codes[nn]


def _prep(df: pl.DataFrame, channels: list[str]) -> tuple[np.ndarray, ...] | None:
    if df.height == 0:
        return None
    t = df.get_column("t").to_numpy()
    x = _clean(df.select(channels).to_numpy())
    act = (
        df.select(pl.col("activity_canonical").fill_null(pl.col("activity")).fill_null(""))
        .to_series()
        .to_numpy()
        .astype(object)
    )
    fog = df.get_column("fog_label").fill_null(-1).cast(pl.Int16).to_numpy()
    t, x, act, fog = _dedup_sort(t, x, act, fog)
    if len(t) < 2:
        return None
    return t, x, act, fog


def build_placement(sub: pl.DataFrame) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """One placement's rows -> (X[T,6] float32, activity[T] str, fog[T] int16) on the 50 Hz grid."""
    a = _prep(sub.filter(pl.col("modality").is_in(ACC_MODS)), _ACC_CH)
    g = _prep(sub.filter(pl.col("modality").is_in(GYR_MODS)), _GYR_CH)
    if a is None and g is None:
        return None

    ref = a if a is not None else g
    assert ref is not None
    t_ref, x_ref, act_ref, fog_ref = ref
    res_ref = _resample(t_ref, x_ref)
    if res_ref is None:
        return None
    t0, x_ref_grid = res_ref
    n = x_ref_grid.shape[0]

    def grid_for(stream: tuple[np.ndarray, ...] | None) -> np.ndarray:
        if stream is None:
            return np.zeros((n, 3), dtype=np.float32)
        if stream is ref:
            return x_ref_grid
        res = _resample(stream[0], stream[1])
        return _fit_length(res[1], n) if res is not None else np.zeros((n, 3), dtype=np.float32)

    acc_grid = grid_for(a)
    gyr_grid = grid_for(g)
    x = np.nan_to_num(np.concatenate([acc_grid, gyr_grid], axis=1)).astype(np.float32)
    act_grid = _labels_to_grid(t_ref, act_ref, t0, n)
    fog_grid = _labels_to_grid(t_ref, fog_ref, t0, n).astype(np.int16)
    return x, act_grid, fog_grid
