# Vendored from Phoenix 1480ab0:services/api/app/execution_score.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Deterministic Execution Score: Volume + Target Achievement + Correctness.

Continuous, target-ratio scoring computed directly from the per-rep features
``attempt_assessment.assess_attempt`` already produces -- no labeled
training data needed, unlike ``app.ml.rep_quality``'s shadow KNN. A rep only
needs to clear its exercise's ``enter_deg`` (== this exercise's
min_valid_excursion, see ``exercise_signals.py``) to count toward Volume;
how close its peak gets to the target angle is Target Achievement, and
pace/hold/return control is Correctness.

    Execution Score = 0.50 * Correctness + 0.20 * Volume + 0.30 * Target

Correctness sub-metrics without a calibrated ``target`` (smoothness,
consistency, and everything for straight-leg-raise except knee stability)
are left out of that rep's average and their weight is redistributed among
the sub-metrics that do have one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

VOLUME_WEIGHT = 0.20
TARGET_WEIGHT = 0.30
CORRECTNESS_WEIGHT = 0.50


@dataclass(frozen=True, slots=True)
class CorrectnessMetric:
    """One weighted Correctness sub-score, read from one rep_features key."""

    name: str
    feature: str
    weight: float
    target: float | None  # None = not calibrated yet; excluded and redistributed
    direction: str = "at_least"  # "at_least": min(100, value/target*100); "at_most": inverse


@dataclass(frozen=True, slots=True)
class ExecutionProfile:
    exercise_id: str
    correctness_metrics: tuple[CorrectnessMetric, ...]
    target_angle_deg: float | None = None  # simple single-target exercises
    elevation_target_deg: float | None = None  # SLR: elevation component of Target
    elevation_weight: float = 1.0  # SLR: 0.7
    knee_lag_limit_deg: float | None = None  # SLR: knee-control component
    knee_lag_weight: float = 0.0  # SLR: 0.3


# Tempo/hold/controlled-return targets below are calibrated from each
# exercise's recorded good/good reference reps (average duration_seconds /
# extension_seconds / hold_seconds). Straight-leg-raise has no recordings
# yet, so its targets are None until a reference take exists -- those
# sub-metrics abstain rather than guess.
EXECUTION_PROFILES: dict[str, ExecutionProfile] = {
    "exercise-heel-slide-v1": ExecutionProfile(
        exercise_id="exercise-heel-slide-v1",
        target_angle_deg=90.0,
        correctness_metrics=(
            CorrectnessMetric("tempo", "duration_seconds", 25.0, 2.5),
            CorrectnessMetric("controlled_return", "extension_seconds", 20.0, 1.3),
            CorrectnessMetric("hold", "hold_seconds", 10.0, 1.1),
            CorrectnessMetric("smoothness", "log_dimensionless_jerk", 30.0, None),
        ),
    ),
    # Target: final knee angle <= 10 deg flexion => ~80 deg extension excursion
    # from the ~90 deg seated rest (assumed; see exercise_signals.py).
    "exercise-seated-knee-extension-v1": ExecutionProfile(
        exercise_id="exercise-seated-knee-extension-v1",
        target_angle_deg=80.0,
        correctness_metrics=(
            CorrectnessMetric("tempo", "duration_seconds", 25.0, 1.2),
            CorrectnessMetric("hold", "hold_seconds", 20.0, 0.8),
            CorrectnessMetric("controlled_return", "extension_seconds", 15.0, 1.1),
            CorrectnessMetric("smoothness", "log_dimensionless_jerk", 30.0, None),
        ),
    ),
    # Knee-control (elevation's 30% component, and Correctness's knee_stability)
    # is disabled: `knee_bend_deg` (shank-thigh relative pitch) measured a
    # 100-105 deg swing across two independent takes, including one with a
    # deliberately locked-straight knee (2026-09-17, via tune_reps.py) -- a
    # real knee lag never gets near that, so the signal itself isn't
    # trustworthy in this posture (likely Euler-angle gimbal coupling as the
    # thigh pitches toward vertical), not a real technique measurement.
    # Re-enable once a validated axis/signal is found; thigh-foot pitch
    # measured smaller (22-25 deg) across both takes but also carries ankle
    # motion, so it's not a drop-in replacement without more investigation.
    "exercise-straight-leg-raise-v1": ExecutionProfile(
        exercise_id="exercise-straight-leg-raise-v1",
        elevation_target_deg=30.0,
        elevation_weight=1.0,
        knee_lag_limit_deg=None,
        knee_lag_weight=0.0,
        correctness_metrics=(
            CorrectnessMetric("tempo", "duration_seconds", 20.0, None),
            CorrectnessMetric("hold", "hold_seconds", 20.0, None),
            CorrectnessMetric("controlled_lowering", "extension_seconds", 20.0, None),
            CorrectnessMetric("knee_stability", "knee_bend_deg", 15.0, None, direction="at_most"),
            CorrectnessMetric("smooth_rise", "log_dimensionless_jerk", 25.0, None),
        ),
    ),
    # --- Exercises below have no reference recordings yet: tempo, return and
    # smoothness targets are None (excluded) until calibrated from good takes.
    # Only targets that come straight from the spec are set.
    "exercise-ball-knee-flexion-v1": ExecutionProfile(
        exercise_id="exercise-ball-knee-flexion-v1",
        target_angle_deg=90.0,
        correctness_metrics=(
            CorrectnessMetric("tempo", "duration_seconds", 25.0, None),
            CorrectnessMetric("controlled_return", "extension_seconds", 20.0, None),
            CorrectnessMetric("hold", "hold_seconds", 10.0, None),
            CorrectnessMetric("smoothness", "log_dimensionless_jerk", 30.0, None),
        ),
    ),
    "exercise-heel-slide-with-band-v1": ExecutionProfile(
        exercise_id="exercise-heel-slide-with-band-v1",
        target_angle_deg=90.0,
        correctness_metrics=(
            CorrectnessMetric("tempo", "duration_seconds", 25.0, None),
            CorrectnessMetric("controlled_return", "extension_seconds", 20.0, None),
            CorrectnessMetric("hold", "hold_seconds", 10.0, None),
            CorrectnessMetric("smoothness", "log_dimensionless_jerk", 30.0, None),
        ),
    ),
    # Spec: knee flexion 60, top hold 0.5 s.
    "exercise-supported-knee-raise-v1": ExecutionProfile(
        exercise_id="exercise-supported-knee-raise-v1",
        target_angle_deg=60.0,
        correctness_metrics=(
            CorrectnessMetric("tempo", "duration_seconds", 25.0, None),
            CorrectnessMetric("controlled_return", "extension_seconds", 20.0, None),
            CorrectnessMetric("top_hold", "hold_seconds", 20.0, 0.5),
            CorrectnessMetric("smoothness", "log_dimensionless_jerk", 30.0, None),
        ),
    ),
    # Spec: elevation 15 deg. Knee extension is "monitored" but knee_bend_deg
    # is not trustworthy yet (see the straight-leg-raise note), so no knee term.
    "exercise-lying-partial-leg-raise-v1": ExecutionProfile(
        exercise_id="exercise-lying-partial-leg-raise-v1",
        elevation_target_deg=15.0,
        correctness_metrics=(
            CorrectnessMetric("tempo", "duration_seconds", 30.0, None),
            CorrectnessMetric("controlled_lowering", "extension_seconds", 30.0, None),
            CorrectnessMetric("smooth_rise", "log_dimensionless_jerk", 40.0, None),
        ),
    ),
    # Spec: elevation 15 deg AND hold >= 3 s. Elevation is Target; the hold is
    # its own Correctness sub-metric with the spec's 3 s target.
    "exercise-lying-partial-leg-hold-v1": ExecutionProfile(
        exercise_id="exercise-lying-partial-leg-hold-v1",
        elevation_target_deg=15.0,
        correctness_metrics=(
            CorrectnessMetric("hold", "hold_seconds", 40.0, 3.0),
            CorrectnessMetric("tempo", "duration_seconds", 15.0, None),
            CorrectnessMetric("controlled_lowering", "extension_seconds", 25.0, None),
            CorrectnessMetric("smooth_rise", "log_dimensionless_jerk", 20.0, None),
        ),
    ),
    # No ROM target (prescribed cycles only): Target is left out and Volume /
    # Correctness carry the score.
    "exercise-ankle-pumps-active-v1": ExecutionProfile(
        exercise_id="exercise-ankle-pumps-active-v1",
        correctness_metrics=(
            CorrectnessMetric("tempo", "duration_seconds", 50.0, None),
            CorrectnessMetric("smoothness", "log_dimensionless_jerk", 50.0, None),
        ),
    ),
    "exercise-resisted-ankle-pump-v1": ExecutionProfile(
        exercise_id="exercise-resisted-ankle-pump-v1",
        correctness_metrics=(
            CorrectnessMetric("tempo", "duration_seconds", 50.0, None),
            CorrectnessMetric("smoothness", "log_dimensionless_jerk", 50.0, None),
        ),
    ),
    # Target is a complete cycle (no angle). Top stabilization (0.5-1.0 s) is
    # not scored: hold_seconds is not produced for stillness-delimited reps.
    "exercise-step-up-v1": ExecutionProfile(
        exercise_id="exercise-step-up-v1",
        correctness_metrics=(
            CorrectnessMetric("tempo", "duration_seconds", 50.0, None),
            CorrectnessMetric("smoothness", "log_dimensionless_jerk", 50.0, None),
        ),
    ),
}


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _metric_score(metric: CorrectnessMetric, value: float | None) -> float | None:
    if value is None or metric.target is None or metric.target <= 0:
        return None
    if metric.direction == "at_most":
        return _clamp(100.0 * (1.0 - value / metric.target))
    return _clamp(100.0 * value / metric.target)


def rep_correctness(
    profile: ExecutionProfile, rep_features: dict[str, float | None]
) -> dict[str, Any]:
    """Correctness for one rep: weighted average of the calibrated sub-metrics."""
    weighted_sum = 0.0
    used_weight = 0.0
    breakdown: dict[str, float] = {}
    for metric in profile.correctness_metrics:
        score = _metric_score(metric, rep_features.get(metric.feature))
        if score is None:
            continue
        breakdown[metric.name] = round(score, 2)
        weighted_sum += score * metric.weight
        used_weight += metric.weight
    if used_weight == 0:
        return {"score": None, "metrics": {}, "reason": "no_calibrated_metrics"}
    return {"score": round(weighted_sum / used_weight, 2), "metrics": breakdown}


def rep_target_achievement(
    profile: ExecutionProfile, rep_features: dict[str, float | None]
) -> dict[str, Any]:
    """Target Achievement for one rep: how close its peak got to the target."""
    peak = rep_features.get("peak_from_rest_deg")
    if profile.elevation_target_deg is not None:
        if peak is None:
            return {"score": None, "reason": "missing_peak_from_rest_deg"}
        elevation_pct = _clamp(100.0 * peak / profile.elevation_target_deg)
        knee_bend = rep_features.get("knee_bend_deg")
        knee_pct = (
            _clamp(100.0 * (1.0 - knee_bend / profile.knee_lag_limit_deg))
            if knee_bend is not None and profile.knee_lag_limit_deg
            else None
        )
        if knee_pct is None:
            return {"score": round(elevation_pct, 2), "elevation": round(elevation_pct, 2)}
        combined = profile.elevation_weight * elevation_pct + profile.knee_lag_weight * knee_pct
        return {
            "score": round(combined, 2),
            "elevation": round(elevation_pct, 2),
            "knee_control": round(knee_pct, 2),
        }
    if profile.target_angle_deg is None or peak is None:
        return {"score": None, "reason": "no_target_configured_or_missing_peak"}
    return {"score": round(_clamp(100.0 * peak / profile.target_angle_deg), 2)}


def volume_score(valid_reps: int, prescribed_reps: int | None) -> dict[str, Any]:
    if not prescribed_reps or prescribed_reps <= 0:
        return {"score": None, "reason": "no_prescribed_reps"}
    return {
        "score": round(_clamp(100.0 * valid_reps / prescribed_reps), 2),
        "valid_reps": valid_reps,
        "prescribed_reps": prescribed_reps,
    }


def assess_execution(
    rep_features: list[dict[str, float | None]],
    exercise_id: str,
    *,
    prescribed_reps: int | None,
) -> dict[str, Any]:
    """Score one completed attempt: Volume + Target + Correctness -> Execution Score.

    Every valid rep (already filtered by the exercise's min_valid_excursion
    upstream, in ``reps.count_repetitions``) counts toward Volume regardless
    of how well it scores on Target/Correctness.
    """
    profile = EXECUTION_PROFILES.get(exercise_id)
    if profile is None:
        return {
            "status": "abstained",
            "reason": "no_execution_profile_for_exercise",
            "exercise_id": exercise_id,
        }
    if not rep_features:
        return {"status": "abstained", "reason": "no_reps", "exercise_id": exercise_id}

    per_rep = []
    target_scores = []
    correctness_scores = []
    for index, row in enumerate(rep_features, start=1):
        target = rep_target_achievement(profile, row)
        correctness = rep_correctness(profile, row)
        per_rep.append({"index": index, "target": target, "correctness": correctness})
        if target["score"] is not None:
            target_scores.append(target["score"])
        if correctness["score"] is not None:
            correctness_scores.append(correctness["score"])

    volume = volume_score(len(rep_features), prescribed_reps)
    avg_target = round(sum(target_scores) / len(target_scores), 2) if target_scores else None
    avg_correctness = (
        round(sum(correctness_scores) / len(correctness_scores), 2)
        if correctness_scores
        else None
    )

    # A component with no score (no ROM target, nothing calibrated, no
    # prescribed reps) is left out and the rest are re-weighted, so a missing
    # component never counts as a zero.
    components = {
        "correctness": (avg_correctness, CORRECTNESS_WEIGHT),
        "volume": (volume["score"], VOLUME_WEIGHT),
        "target": (avg_target, TARGET_WEIGHT),
    }
    used = {name: pair for name, pair in components.items() if pair[0] is not None}
    used_weight = sum(weight for _, weight in used.values())
    execution_score = (
        round(sum(score * weight for score, weight in used.values()) / used_weight, 2)
        if used_weight
        else None
    )
    return {
        "status": "scored",
        "exercise_id": exercise_id,
        "components_used": {
            name: round(weight / used_weight, 3) for name, (_, weight) in used.items()
        }
        if used_weight
        else {},
        "execution_score": execution_score,
        "volume": volume,
        "target_achievement": {"score": avg_target},
        "correctness": {"score": avg_correctness},
        "reps": per_rep,
    }
