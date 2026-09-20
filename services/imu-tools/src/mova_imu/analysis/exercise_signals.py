# Vendored from Phoenix 1480ab0:services/api/app/exercise_signals.py
# Do not edit in mova -- change it upstream in Phoenix and re-copy. See VENDORED.md.
"""Per-exercise signal profiles for repetition segmentation and assessment.

A profile says which orientation signal carries an exercise's movement, how a
repetition is delimited, and which secondary signals describe form. The
auto-selected proxy in ``app.reps.flexion_signal`` picks whichever segment pair
swings most in a window. That can differ between two takes of the same exercise,
which is fine for a live counter but makes per-rep features incomparable across
recordings. A profile pins the signal so they are comparable.

Engineering defaults, not clinical definitions. Axes assume the sensor placement
used for the reference recordings and must be re-confirmed with
``scripts/tune_reps.py`` whenever that placement changes. An exercise
definition may override its profile with a ``signal_profile`` object in its
``configuration``.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

ROLES = ("thigh", "shank", "foot")
AXES = ("ori_roll", "ori_pitch")  # yaw is never allowed: without a magnetometer it drifts
SIGNAL_KINDS = ("relative", "absolute")
REP_PATTERNS = ("single_excursion", "stillness_delimited")
SECONDARY_MEASURES = ("max_abs_deviation", "range")


@dataclass(frozen=True, slots=True)
class SignalSpec:
    """One orientation signal: a segment-pair difference or a single segment angle."""

    kind: str  # "relative" (distal - proximal) | "absolute" (one segment)
    axis: str
    role: str | None = None  # absolute only
    distal: str | None = None  # relative only
    proximal: str | None = None  # relative only

    def __post_init__(self) -> None:
        if self.kind not in SIGNAL_KINDS:
            raise ValueError(f"unknown signal kind: {self.kind!r}")
        if self.axis not in AXES:
            raise ValueError(f"signal axis must be one of {AXES}, got {self.axis!r}")
        roles = (self.distal, self.proximal) if self.kind == "relative" else (self.role,)
        if any(role not in ROLES for role in roles):
            raise ValueError(f"signal roles must be among {ROLES}, got {roles}")
        if self.kind == "relative" and self.distal == self.proximal:
            raise ValueError("a relative signal needs two different segments")

    @property
    def label(self) -> str:
        if self.kind == "relative":
            return f"{self.distal}_minus_{self.proximal}_{self.axis}_deg"
        return f"{self.role}_{self.axis}_deg"

    def as_dict(self) -> dict[str, Any]:
        if self.kind == "relative":
            return {
                "kind": self.kind,
                "axis": self.axis,
                "distal": self.distal,
                "proximal": self.proximal,
            }
        return {"kind": self.kind, "axis": self.axis, "role": self.role}

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> SignalSpec:
        return cls(
            kind=str(raw.get("kind", "")),
            axis=str(raw.get("axis", "")),
            role=raw.get("role"),
            distal=raw.get("distal"),
            proximal=raw.get("proximal"),
        )


@dataclass(frozen=True, slots=True)
class SecondarySignal:
    """A form signal measured per repetition, e.g. knee bend during a leg raise."""

    name: str  # the per-rep feature name, e.g. "knee_bend_deg"
    spec: SignalSpec
    measure: str  # "max_abs_deviation" (from rest) | "range" (max - min within the rep)

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("secondary signal name is required")
        if self.measure not in SECONDARY_MEASURES:
            raise ValueError(f"unknown secondary measure: {self.measure!r}")

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.name, "spec": self.spec.as_dict(), "measure": self.measure}

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> SecondarySignal:
        return cls(
            name=str(raw.get("name", "")),
            spec=SignalSpec.from_dict(raw.get("spec", {})),
            measure=str(raw.get("measure", "")),
        )


@dataclass(frozen=True, slots=True)
class SignalProfile:
    exercise_id: str
    # What the primary signal's degrees measure, in words the LLM glossary
    # explains: "knee_bend" | "leg_lift" | "knee_straightening".
    movement_angle: str
    rep_pattern: str
    primary: SignalSpec
    secondary: tuple[SecondarySignal, ...] = ()
    enter_deg: float = 18.0  # excursion from rest that starts a rep / counts as a hump
    exit_deg: float = 7.0  # back within this of rest ends a rep
    min_rep_seconds: float = 0.5
    # stillness_delimited only: every segment's roll/pitch rate below this for
    # at least min_still_seconds is a rest between reps.
    still_rate_dps: float = 15.0
    min_still_seconds: float = 0.7

    def __post_init__(self) -> None:
        if self.rep_pattern not in REP_PATTERNS:
            raise ValueError(f"unknown rep pattern: {self.rep_pattern!r}")
        if not 0 <= self.exit_deg < self.enter_deg:
            raise ValueError("thresholds need 0 <= exit_deg < enter_deg")
        if self.min_rep_seconds <= 0 or self.still_rate_dps <= 0 or self.min_still_seconds <= 0:
            raise ValueError("durations and rates must be positive")
        names = [signal.name for signal in self.secondary]
        if len(set(names)) != len(names):
            raise ValueError("secondary signal names must be unique")

    def as_dict(self) -> dict[str, Any]:
        return {
            "movement_angle": self.movement_angle,
            "rep_pattern": self.rep_pattern,
            "primary": self.primary.as_dict(),
            "secondary": [signal.as_dict() for signal in self.secondary],
            "enter_deg": self.enter_deg,
            "exit_deg": self.exit_deg,
            "min_rep_seconds": self.min_rep_seconds,
            "still_rate_dps": self.still_rate_dps,
            "min_still_seconds": self.min_still_seconds,
        }

    @classmethod
    def from_dict(
        cls, exercise_id: str, raw: Mapping[str, Any], *, base: SignalProfile | None = None
    ) -> SignalProfile:
        """Build a profile from JSON; keys absent from ``raw`` fall back to ``base``."""
        merged: dict[str, Any] = base.as_dict() if base else {}
        merged.update(raw)
        return cls(
            exercise_id=exercise_id,
            movement_angle=str(merged.get("movement_angle", "")),
            rep_pattern=str(merged.get("rep_pattern", "single_excursion")),
            primary=SignalSpec.from_dict(merged.get("primary", {})),
            secondary=tuple(
                SecondarySignal.from_dict(item) for item in merged.get("secondary", [])
            ),
            enter_deg=float(merged.get("enter_deg", 18.0)),
            exit_deg=float(merged.get("exit_deg", 7.0)),
            min_rep_seconds=float(merged.get("min_rep_seconds", 0.5)),
            still_rate_dps=float(merged.get("still_rate_dps", 15.0)),
            min_still_seconds=float(merged.get("min_still_seconds", 0.7)),
        )


_KNEE = SignalSpec(kind="relative", axis="ori_pitch", distal="shank", proximal="thigh")
_THIGH = SignalSpec(kind="absolute", axis="ori_pitch", role="thigh")
_ANKLE = SignalSpec(kind="relative", axis="ori_pitch", distal="foot", proximal="shank")

SIGNAL_PROFILES: dict[str, SignalProfile] = {
    profile.exercise_id: profile
    for profile in (
        # enter_deg is this exercise's min_valid_excursion (execution-score
        # spec): max(15, 25% * 90 target) = 22.5. A rep below this doesn't
        # count at all, valid or not -- see app.execution_score.
        SignalProfile(
            exercise_id="exercise-heel-slide-v1",
            movement_angle="knee_bend",
            rep_pattern="single_excursion",
            primary=_KNEE,
            enter_deg=22.5,
            exit_deg=7.0,
        ),
        # The knee stays straight, so every segment-pair difference stays ~0;
        # the lift only shows up as the thigh's own angle. enter_deg is this
        # exercise's min_valid_excursion (execution-score spec): 10 deg of
        # elevation, well below the 30 deg target.
        SignalProfile(
            exercise_id="exercise-straight-leg-raise-v1",
            movement_angle="leg_lift",
            rep_pattern="single_excursion",
            primary=_THIGH,
            secondary=(SecondarySignal("knee_bend_deg", _KNEE, "max_abs_deviation"),),
            enter_deg=10.0,
            exit_deg=5.0,
        ),
        # Rest is the seated ~90 deg flexed knee; the excursion is extension.
        # Spec target: final knee angle <= 10 deg flexion, i.e. an ~80 deg
        # extension excursion from that rest (assumes rest is ~90 deg flexed;
        # the sensors give relative pitch, not an absolute knee angle).
        # enter_deg is min_valid_excursion = max(15, 25% * 80) = 20.
        SignalProfile(
            exercise_id="exercise-seated-knee-extension-v1",
            movement_angle="knee_straightening",
            rep_pattern="single_excursion",
            primary=_KNEE,
            secondary=(SecondarySignal("thigh_lift_deg", _THIGH, "max_abs_deviation"),),
            enter_deg=20.0,
            exit_deg=7.0,
        ),
        # Two knee humps per rep (step up, step down): reps are delimited by
        # standing still on the floor, not by one excursion.
        SignalProfile(
            exercise_id="exercise-step-up-v1",
            movement_angle="knee_bend",
            rep_pattern="stillness_delimited",
            primary=_KNEE,
            secondary=(
                SecondarySignal("thigh_tilt_deg", _THIGH, "max_abs_deviation"),
                SecondarySignal(
                    "shank_wobble_deg",
                    SignalSpec(kind="absolute", axis="ori_roll", role="shank"),
                    "range",
                ),
            ),
            enter_deg=15.0,
            exit_deg=7.0,
            min_rep_seconds=1.5,
            # Protocol: ~2 s standing pause on the floor between reps, no real
            # stop on top of the step. Resampling and smoothing eat ~0.3 s of a
            # pause's edges, so the threshold sits well under the floor pause.
            min_still_seconds=1.0,
        ),
        # Same knee-flexion signal as heel slide; target 90 deg,
        # min_valid_excursion = max(15, 25% * 90) = 22.5.
        SignalProfile(
            exercise_id="exercise-ball-knee-flexion-v1",
            movement_angle="knee_bend",
            rep_pattern="single_excursion",
            primary=_KNEE,
            enter_deg=22.5,
            exit_deg=7.0,
        ),
        # Heel slide with a band: same signal and thresholds as heel slide.
        SignalProfile(
            exercise_id="exercise-heel-slide-with-band-v1",
            movement_angle="knee_bend",
            rep_pattern="single_excursion",
            primary=_KNEE,
            enter_deg=22.5,
            exit_deg=7.0,
        ),
        # Target 60 deg knee flexion, MVE 15 deg, 0.5 s top hold.
        SignalProfile(
            exercise_id="exercise-supported-knee-raise-v1",
            movement_angle="knee_bend",
            rep_pattern="single_excursion",
            primary=_KNEE,
            enter_deg=15.0,
            exit_deg=7.0,
        ),
        # Leg elevation 15 deg, MVE 8 deg. Knee extension is monitored by
        # knee_bend_deg, but that signal is not trusted yet (see
        # execution_score.py's straight-leg-raise note), so it only feeds
        # features, never the score.
        SignalProfile(
            exercise_id="exercise-lying-partial-leg-raise-v1",
            movement_angle="leg_lift",
            rep_pattern="single_excursion",
            primary=_THIGH,
            secondary=(SecondarySignal("knee_bend_deg", _KNEE, "max_abs_deviation"),),
            enter_deg=8.0,
            exit_deg=4.0,
        ),
        # As the partial raise, plus a 3 s hold at the top.
        SignalProfile(
            exercise_id="exercise-lying-partial-leg-hold-v1",
            movement_angle="leg_lift",
            rep_pattern="single_excursion",
            primary=_THIGH,
            secondary=(SecondarySignal("knee_bend_deg", _KNEE, "max_abs_deviation"),),
            enter_deg=8.0,
            exit_deg=4.0,
        ),
        # The spec's MVE is 8 deg TOTAL ankle excursion; a pump is counted on
        # its dominant direction only (the opposite phase drops below rest), so
        # enter_deg is set to half of that. Unvalidated on hardware.
        SignalProfile(
            exercise_id="exercise-ankle-pumps-active-v1",
            movement_angle="ankle_pump",
            rep_pattern="single_excursion",
            primary=_ANKLE,
            enter_deg=4.0,
            exit_deg=2.0,
        ),
        # Same ankle signal; target is prescribed complete cycles, no ROM.
        SignalProfile(
            exercise_id="exercise-resisted-ankle-pump-v1",
            movement_angle="ankle_pump",
            rep_pattern="single_excursion",
            primary=_ANKLE,
            enter_deg=4.0,
            exit_deg=2.0,
        ),
    )
}


def profile_for(
    exercise_id: str, configuration: Mapping[str, Any] | None = None
) -> SignalProfile | None:
    """The exercise's profile, with a ``configuration["signal_profile"]`` override applied.

    ``None`` means no profile: callers fall back to the auto-selected proxy.
    """
    base = SIGNAL_PROFILES.get(exercise_id)
    override = (configuration or {}).get("signal_profile")
    if isinstance(override, Mapping):
        return SignalProfile.from_dict(exercise_id, override, base=base)
    return base
