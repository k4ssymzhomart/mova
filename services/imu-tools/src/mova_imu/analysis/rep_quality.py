# Vendored from Phoenix 1480ab0:services/api/app/ml/rep_quality.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Small-data rep-quality assessment: one distance-weighted KNN per quality.

Every repetition is rated on two qualities, each bad / mediocre / good:

- ``range``: how far the movement goes (for a step-up, how straight the knee
  gets on the step);
- ``tempo``: how fast and controlled it is, including the hold.

Each quality has its own small KNN over only that quality's features. A rushed
rep with full range is then rated "range good, tempo bad", rather than one
blurred "mediocre".

Reference sets are built offline by ``scripts/build_rep_quality_reference.py``
from hand-labeled takes and stored per exercise as
``checkpoints/rep_quality/<exercise_id>.json``. A new rep's feature row
(``app.attempt_assessment``) is z-scored with the reference stats. Its k nearest
reference reps then vote with inverse-distance weights on an ordinal score:
bad 0, mediocre 0.5, good 1.

Shadow only. The labels are engineering labels from deliberately performed
takes, not a clinically approved quality definition. Output goes to
``shadow_predictions`` and, behind a dev flag, to the LLM feedback facts; never
to a score. A rep far from every reference rep abstains instead of guessing.
Pure numpy, so no new runtime dependency.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

# mova: renamed from `checkpoints/rep_quality`. mova's root .gitignore has a bare,
# unanchored `checkpoints/` rule that would silently untrack the reference sets.
REFERENCE_DIR = Path(__file__).parent / "reference_sets"
REFERENCE_FORMAT = "phoenix-rep-quality-knn/2"
ALGORITHM_VERSION = "algorithm-rep-quality-knn-v1"

QUALITIES = ("range", "tempo")
LABELS = ("bad", "mediocre", "good")
LABEL_SCORES = {"bad": 0.0, "mediocre": 0.5, "good": 1.0}
MEDIOCRE_FROM = 1 / 3  # score thresholds back to a label
GOOD_FROM = 2 / 3

# The features each quality is rated on. A step-up rep is two knee humps, so its
# range is how straight the knee gets on the step, and its tempo is the push-up
# and step-down phases rather than a split at a single peak.
DEFAULT_QUALITY_FEATURES: dict[str, tuple[str, ...]] = {
    "range": ("peak_from_rest_deg", "rom_degrees"),
    "tempo": ("duration_seconds", "flexion_seconds", "extension_seconds", "hold_seconds"),
}
QUALITY_FEATURES_BY_EXERCISE: dict[str, dict[str, tuple[str, ...]]] = {
    "exercise-step-up-v1": {
        "range": ("peak_from_rest_deg", "residual_flexion_on_step_deg", "hump_count"),
        "tempo": ("duration_seconds", "push_up_seconds", "step_down_seconds"),
    },
}

DEFAULT_K = 5
# A rep farther than this percentile of the reference set's own
# nearest-other-recording distances, times the margin, is unlike anything
# recorded: abstain. The bare percentile would reject ~5% of ordinary reps by
# construction.
ABSTAIN_PERCENTILE = 95.0
ABSTAIN_MARGIN = 1.5
# A feature measured on fewer than this share of reference reps is not used.
MIN_FEATURE_COVERAGE = 0.5
ISSUE_Z_THRESHOLD = 1.0  # at least one reference std worse than the good reps
MAX_ISSUES = 2

# feature -> (direction, issue code). direction -1: lower than the good reps is
# worse; +1: higher is worse. Durations only flag the fast side: rushing is the
# failure the labels describe.
ISSUE_RULES: dict[str, tuple[float, str]] = {
    "peak_from_rest_deg": (-1.0, "range_small"),
    "rom_degrees": (-1.0, "range_small"),
    "residual_flexion_on_step_deg": (1.0, "incomplete_extension"),
    "hump_count": (-1.0, "incomplete_extension"),
    "duration_seconds": (-1.0, "too_fast"),
    "flexion_seconds": (-1.0, "too_fast"),
    "extension_seconds": (-1.0, "uncontrolled_descent"),
    "hold_seconds": (-1.0, "no_hold"),
    "push_up_seconds": (-1.0, "too_fast"),
    "step_down_seconds": (-1.0, "uncontrolled_descent"),
}

_EXERCISE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")


def quality_features(exercise_id: str | None, quality: str) -> tuple[str, ...]:
    """The candidate features ``quality`` is rated on for this exercise."""
    if quality not in QUALITIES:
        raise ValueError(f"unknown quality: {quality!r}")
    per_exercise = QUALITY_FEATURES_BY_EXERCISE.get(exercise_id or "", {})
    return per_exercise.get(quality, DEFAULT_QUALITY_FEATURES[quality])


def label_for_score(score: float) -> str:
    if score >= GOOD_FROM:
        return "good"
    if score >= MEDIOCRE_FROM:
        return "mediocre"
    return "bad"


@dataclass(frozen=True)
class ReferenceSet:
    """The labeled reference reps for one exercise and one quality."""

    model_version: str
    exercise_id: str
    quality: str
    feature_names: tuple[str, ...]
    mean: np.ndarray  # (d,) imputation value and z-score centre
    std: np.ndarray  # (d,) z-score scale, 1.0 where a feature was constant
    k: int
    abstain_distance: float
    features: np.ndarray  # (n, d) raw values, gaps already imputed with ``mean``
    labels: tuple[str, ...]
    recording_ids: tuple[str, ...]
    standardized: np.ndarray = field(init=False, repr=False)
    scores: np.ndarray = field(init=False, repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "standardized", (self.features - self.mean) / self.std)
        object.__setattr__(
            self, "scores", np.array([LABEL_SCORES[label] for label in self.labels], dtype=float)
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "quality": self.quality,
            "feature_names": list(self.feature_names),
            "mean": self.mean.tolist(),
            "std": self.std.tolist(),
            "k": self.k,
            "abstain_distance": self.abstain_distance,
            "features": self.features.tolist(),
            "labels": list(self.labels),
            "recording_ids": list(self.recording_ids),
        }

    @classmethod
    def from_json(
        cls, raw: Mapping[str, Any], *, exercise_id: str, model_version: str
    ) -> ReferenceSet:
        reference = cls(
            model_version=model_version,
            exercise_id=exercise_id,
            quality=str(raw["quality"]),
            feature_names=tuple(raw["feature_names"]),
            mean=np.array(raw["mean"], dtype=float),
            std=np.array(raw["std"], dtype=float),
            k=int(raw["k"]),
            abstain_distance=float(raw["abstain_distance"]),
            features=np.array(raw["features"], dtype=float).reshape(
                -1, len(raw["feature_names"])
            ),
            labels=tuple(raw["labels"]),
            recording_ids=tuple(raw["recording_ids"]),
        )
        rows = reference.features.shape[0]
        if not rows or rows != len(reference.labels) or rows != len(reference.recording_ids):
            raise ValueError("reference features, labels and recording ids must align")
        return reference


def models_to_json(models: Mapping[str, ReferenceSet]) -> dict[str, Any]:
    """One exercise's per-quality reference sets as the stored file payload."""
    if not models:
        raise ValueError("no models to store")
    first = next(iter(models.values()))
    return {
        "format": REFERENCE_FORMAT,
        "algorithm_version": ALGORITHM_VERSION,
        "exercise_id": first.exercise_id,
        "model_version": first.model_version,
        "models": {quality: reference.to_json() for quality, reference in models.items()},
    }


def models_from_json(raw: Mapping[str, Any]) -> dict[str, ReferenceSet]:
    if raw.get("format") != REFERENCE_FORMAT:
        raise ValueError(f"unsupported reference format: {raw.get('format')!r}")
    exercise_id, model_version = str(raw["exercise_id"]), str(raw["model_version"])
    models: dict[str, ReferenceSet] = {}
    for quality, body in dict(raw["models"]).items():
        if quality not in QUALITIES:
            raise ValueError(f"unknown quality: {quality!r}")
        reference = ReferenceSet.from_json(
            body, exercise_id=exercise_id, model_version=model_version
        )
        if reference.quality != quality:
            raise ValueError(f"model stored under {quality!r} rates {reference.quality!r}")
        models[quality] = reference
    if not models:
        raise ValueError("reference file holds no models")
    return models


def _value(row: Mapping[str, float | None], name: str) -> float:
    value = row.get(name)
    return float("nan") if value is None else float(value)


def _select_features(
    rows: Sequence[Mapping[str, float | None]], candidates: Sequence[str]
) -> tuple[str, ...]:
    """The candidates measured on enough reps that also vary across them."""
    selected = []
    for name in candidates:
        present = [float(row[name]) for row in rows if row.get(name) is not None]
        if len(present) / len(rows) >= MIN_FEATURE_COVERAGE and max(present) > min(present):
            selected.append(name)
    return tuple(selected)


def _nearest_other_recording(standardized: np.ndarray, recording_ids: Sequence[str]) -> np.ndarray:
    """Per rep: distance to the nearest rep from a *different* recording.

    Reps of one take are near-duplicates of each other, so same-take distances
    would make the abstain threshold far too tight. With a single recording,
    falls back to the nearest other rep.
    """
    distances = np.linalg.norm(standardized[:, None, :] - standardized[None, :, :], axis=2)
    groups = np.array(recording_ids)
    blocked = groups[:, None] == groups[None, :]
    if blocked.all():
        blocked = np.eye(len(groups), dtype=bool)
    nearest = np.where(blocked, np.inf, distances).min(axis=1)
    return nearest[np.isfinite(nearest)]


def fit_reference(
    rows: Sequence[Mapping[str, float | None]],
    labels: Sequence[str],
    recording_ids: Sequence[str],
    *,
    exercise_id: str,
    quality: str,
    model_version: str,
    feature_names: Sequence[str] | None = None,
    k: int = DEFAULT_K,
) -> ReferenceSet:
    """Build one quality's reference set from labeled rows (unlabeled rows excluded)."""
    if not rows or not len(rows) == len(labels) == len(recording_ids):
        raise ValueError("need one label and one recording id per feature row")
    unknown = sorted(set(labels) - set(LABELS))
    if unknown:
        raise ValueError(f"unknown labels: {unknown}")
    candidates = tuple(feature_names) if feature_names else quality_features(exercise_id, quality)
    names = _select_features(rows, candidates)
    if not names:
        raise ValueError(f"no usable {quality} features: every candidate is missing or constant")
    matrix = np.array([[_value(row, name) for name in names] for row in rows], dtype=float)
    mean = np.nanmean(matrix, axis=0)
    filled = np.where(np.isnan(matrix), mean, matrix)
    spread = filled.std(axis=0)
    std = np.where(spread > 1e-9, spread, 1.0)
    nearest = _nearest_other_recording((filled - mean) / std, recording_ids)
    abstain_distance = (
        float(np.percentile(nearest, ABSTAIN_PERCENTILE)) * ABSTAIN_MARGIN
        if nearest.size
        else float("inf")
    )
    return ReferenceSet(
        model_version=model_version,
        exercise_id=exercise_id,
        quality=quality,
        feature_names=names,
        mean=mean,
        std=std,
        k=max(1, min(k, len(rows))),
        abstain_distance=abstain_distance,
        features=filled,
        labels=tuple(labels),
        recording_ids=tuple(recording_ids),
    )


def predict_row(reference: ReferenceSet, row: Mapping[str, float | None]) -> dict[str, Any]:
    """Rate one rep on the reference's quality: weighted neighbour score, label,
    confidence, abstention, issues.

    Distance uses only the features this rep has, rescaled to the full feature
    count. Filling a gap with the reference mean instead would pull the rep
    toward the middle of all classes and make it look unlike every one of them.
    """
    raw = np.array([_value(row, name) for name in reference.feature_names], dtype=float)
    present = ~np.isnan(raw)
    if not present.any():
        return {
            "label": None,
            "score": None,
            "confidence": None,
            "nearest_distance": None,
            "abstained": True,
            "issues": [],
        }
    point = np.where(present, (raw - reference.mean) / reference.std, 0.0)
    gaps = reference.standardized[:, present] - point[present]
    distances = np.linalg.norm(gaps, axis=1) * np.sqrt(present.size / present.sum())
    order = np.argsort(distances, kind="stable")[: reference.k]
    nearest = distances[order]
    weights = 1.0 / (nearest + 1e-6)
    score = float(np.dot(weights, reference.scores[order]) / weights.sum())
    label = label_for_score(score)
    agrees = np.array([label_for_score(value) == label for value in reference.scores[order]])
    confidence = float(weights[agrees].sum() / weights.sum())
    abstained = bool(nearest[0] > reference.abstain_distance)
    return {
        "label": None if abstained else label,
        "score": round(score, 4),
        "confidence": round(confidence, 4),
        "nearest_distance": round(float(nearest[0]), 4),
        "abstained": abstained,
        "issues": [] if abstained or label == "good" else _issues(reference, point, present),
    }


def _issues(
    reference: ReferenceSet, point: np.ndarray, present: np.ndarray
) -> list[dict[str, Any]]:
    """The measured features that fall furthest on their worse side of the good reps."""
    good = reference.scores == LABEL_SCORES["good"]
    if not good.any():
        return []
    centre = reference.standardized[good].mean(axis=0)
    candidates = []
    for position, name in enumerate(reference.feature_names):
        if name not in ISSUE_RULES or not present[position]:
            continue
        direction, code = ISSUE_RULES[name]
        worse_by = direction * (point[position] - centre[position])
        if worse_by >= ISSUE_Z_THRESHOLD:
            candidates.append((worse_by, code, name, position))
    candidates.sort(reverse=True)
    issues: list[dict[str, Any]] = []
    for _, code, name, position in candidates:
        if any(issue["code"] == code for issue in issues):
            continue
        scale, offset = reference.std[position], reference.mean[position]
        issues.append(
            {
                "code": code,
                "feature": name,
                "value": round(float(point[position] * scale + offset), 3),
                "typical_good": round(float(centre[position] * scale + offset), 3),
            }
        )
        if len(issues) == MAX_ISSUES:
            break
    return issues


@lru_cache(maxsize=16)
def _load_models_cached(directory: str, exercise_id: str) -> dict[str, ReferenceSet] | None:
    path = Path(directory) / f"{exercise_id}.json"
    if not path.is_file():
        return None
    try:
        models = models_from_json(json.loads(path.read_text(encoding="utf-8")))
    except (KeyError, TypeError, ValueError):
        return None
    if any(reference.exercise_id != exercise_id for reference in models.values()):
        return None
    return models


def load_models(exercise_id: str) -> dict[str, ReferenceSet] | None:
    """The exercise's per-quality reference sets, or None when absent, malformed
    or mismatched."""
    if not _EXERCISE_ID.fullmatch(exercise_id or ""):
        return None
    return _load_models_cached(str(REFERENCE_DIR), exercise_id)


def reset_reference_cache() -> None:
    """Drop cached reference sets so newly built ones are picked up."""
    _load_models_cached.cache_clear()


def abstention(
    exercise_id: str | None, reason: str, *, model_version: str | None = None
) -> dict[str, Any]:
    """The JSON shape of a rep-quality result that rated nothing, and why."""
    return {
        "algorithm_version": ALGORITHM_VERSION,
        "exercise_id": exercise_id,
        "model_version": model_version,
        "shadow_mode": True,
        "affects_score": False,
        "status": "abstained",
        "reason": reason,
        "qualities": [],
        "reps": [],
        "summary": None,
    }


def assess_reps(
    rep_features: Sequence[Mapping[str, float | None]],
    exercise_id: str | None,
    *,
    models: Mapping[str, ReferenceSet] | None = None,
) -> dict[str, Any]:
    """Shadow-mode per-rep, per-quality ratings for one attempt; JSON-safe."""
    if models is None and exercise_id:
        models = load_models(exercise_id)
    if not models:
        return abstention(exercise_id, "no_reference_for_exercise")
    qualities = [quality for quality in QUALITIES if quality in models]
    result = abstention(
        exercise_id, "no_reps", model_version=models[qualities[0]].model_version
    )
    result["qualities"] = qualities
    if not rep_features:
        return result
    reps = [
        {
            "index": index,
            **{quality: predict_row(models[quality], row) for quality in qualities},
        }
        for index, row in enumerate(rep_features, start=1)
    ]
    summary: dict[str, Any] = {}
    first_issues: Counter[str] = Counter()
    for quality in qualities:
        ratings = [rep[quality] for rep in reps]
        counts = Counter(rating["label"] for rating in ratings if not rating["abstained"])
        summary[quality] = {
            "good": counts["good"],
            "mediocre": counts["mediocre"],
            "bad": counts["bad"],
            "abstained": sum(1 for rating in ratings if rating["abstained"]),
        }
        first_issues.update(rating["issues"][0]["code"] for rating in ratings if rating["issues"])
    summary["main_issue"] = first_issues.most_common(1)[0][0] if first_issues else None
    result.update({"status": "predicted", "reason": None, "reps": reps, "summary": summary})
    return result


def leave_one_recording_out(
    rows: Sequence[Mapping[str, float | None]],
    labels: Sequence[str],
    recording_ids: Sequence[str],
    *,
    exercise_id: str | None,
    quality: str,
    k: int = DEFAULT_K,
    feature_names: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Hold out each recording in turn, fit on the rest, rate the held-out reps.

    Never a random split of reps: reps of one take are near-duplicates, so a
    random split would leak and flatter the model. A fold whose training part
    has no usable features counts its held-out reps as abstained.
    """
    truths: list[str] = []
    predictions: list[str | None] = []
    for held_out in dict.fromkeys(recording_ids):
        train = [i for i, group in enumerate(recording_ids) if group != held_out]
        test = [i for i, group in enumerate(recording_ids) if group == held_out]
        if len(train) < 2:
            continue
        try:
            reference = fit_reference(
                [rows[i] for i in train],
                [labels[i] for i in train],
                [recording_ids[i] for i in train],
                exercise_id=exercise_id or "cross-validation",
                quality=quality,
                model_version="cross-validation",
                feature_names=feature_names or quality_features(exercise_id, quality),
                k=k,
            )
        except ValueError:
            reference = None
        for i in test:
            truths.append(labels[i])
            predictions.append(predict_row(reference, rows[i])["label"] if reference else None)

    assessed = [(t, p) for t, p in zip(truths, predictions, strict=True) if p is not None]
    per_label: dict[str, dict[str, float]] = {}
    for label in LABELS:
        support = sum(1 for t, _ in assessed if t == label)
        predicted = sum(1 for _, p in assessed if p == label)
        hits = sum(1 for t, p in assessed if t == p == label)
        precision = hits / predicted if predicted else 0.0
        recall = hits / support if support else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_label[label] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "support": support,
        }
    present = [label for label in LABELS if per_label[label]["support"]]
    confusion = {
        truth: {
            predicted: sum(
                1
                for t, p in zip(truths, predictions, strict=True)
                if t == truth and (p or "abstained") == predicted
            )
            for predicted in (*LABELS, "abstained")
        }
        for truth in LABELS
    }
    total = len(truths)
    return {
        "quality": quality,
        "reps": total,
        "assessed": len(assessed),
        "abstain_rate": round(1 - len(assessed) / total, 4) if total else None,
        "accuracy": (
            round(sum(t == p for t, p in assessed) / len(assessed), 4) if assessed else None
        ),
        "macro_f1": (
            round(sum(per_label[label]["f1"] for label in present) / len(present), 4)
            if present
            else None
        ),
        # Always predicting the most common label. Taken over all reps: per fold
        # it would never be the held-out take's class when takes are
        # single-class, and the baseline would read as 0%.
        "majority_baseline_accuracy": (
            round(max(Counter(truths).values()) / total, 4) if total else None
        ),
        "per_label": per_label,
        "confusion": confusion,
    }
