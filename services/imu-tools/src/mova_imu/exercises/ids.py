"""Exercise identity across mova and Phoenix.

mova carries three id spaces for the same exercises and none of them can be
derived from another:

===========  =========================  ==============================================
space        example                    where it is the truth
===========  =========================  ==============================================
``catalog``  ``heel-slide``             ``lib/exercises/catalog.ts``, ``public.exercises``
``scoring``  ``heel_slide``             the ``ExerciseSlug`` union in ``lib/scoring/types.ts``
``phoenix``  ``exercise-heel-slide-v1`` ``SIGNAL_PROFILES`` / ``EXECUTION_PROFILES``
===========  =========================  ==============================================

``catalog`` is canonical: it is what the hosted database holds and what every
runtime path in the app resolves.

**Nothing here guesses.** No ``replace("-", "_")``, no prefix-stripping. String
transformation is precisely how ``heel-slide`` and ``heel_slide`` ended up as
two separate things in this repo, and the unapplied migration ``0038`` would
have created a duplicate production row on the strength of that guess. A lookup
that has no row raises :class:`UnknownExercise` and names what it does know.

The table maps identity only -- never a threshold, a target or a sensor list.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

#: services/imu-tools/exercise_ids.json -- shared with the TypeScript side.
TABLE_PATH = Path(__file__).resolve().parents[3] / "exercise_ids.json"


class UnknownExercise(KeyError):
    """No row for this id. The message lists the ids that do exist."""

    def __init__(self, value: str, space: str, known: list[str]) -> None:
        self.value = value
        self.space = space
        super().__init__(
            f"no {space} id {value!r} in {TABLE_PATH.name}. "
            f"Known {space} ids: {', '.join(sorted(known))}"
        )

    def __str__(self) -> str:  # KeyError repr-quotes its arg; this reads better
        return self.args[0]


@dataclass(frozen=True, slots=True)
class ExerciseIds:
    catalog: str
    scoring: str | None
    phoenix: str | None


@lru_cache(maxsize=1)
def _table() -> tuple[ExerciseIds, ...]:
    raw = json.loads(TABLE_PATH.read_text(encoding="utf-8"))
    rows = tuple(
        ExerciseIds(
            catalog=str(row["catalog"]),
            scoring=row["scoring"] if row.get("scoring") else None,
            phoenix=row["phoenix"] if row.get("phoenix") else None,
        )
        for row in raw["exercises"]
    )
    for space in ("catalog", "scoring", "phoenix"):
        seen = [getattr(r, space) for r in rows if getattr(r, space)]
        duplicates = {v for v in seen if seen.count(v) > 1}
        if duplicates:
            raise ValueError(f"duplicate {space} id(s) in {TABLE_PATH.name}: {sorted(duplicates)}")
    return rows


@lru_cache(maxsize=1)
def phoenix_unmapped() -> tuple[str, ...]:
    """Phoenix signal profiles deliberately without a mova exercise."""
    raw = json.loads(TABLE_PATH.read_text(encoding="utf-8"))
    return tuple(raw.get("phoenix_unmapped", {}).get("ids", []))


def all_rows() -> tuple[ExerciseIds, ...]:
    return _table()


def _find(space: str, value: str) -> ExerciseIds:
    for row in _table():
        if getattr(row, space) == value:
            return row
    known = [getattr(r, space) for r in _table() if getattr(r, space)]
    raise UnknownExercise(value, space, known)


def resolve(value: str) -> ExerciseIds:
    """Look an exercise up by an id in any of the three spaces."""
    for space in ("catalog", "phoenix", "scoring"):
        try:
            return _find(space, value)
        except UnknownExercise:
            continue
    every = sorted(
        {v for r in _table() for v in (r.catalog, r.scoring, r.phoenix) if v}
    )
    raise UnknownExercise(value, "any", every)


def phoenix_id(value: str) -> str:
    """The Phoenix ``SIGNAL_PROFILES`` key. Raises when the exercise has no profile."""
    row = resolve(value)
    if row.phoenix is None:
        raise UnknownExercise(
            value, "phoenix", [r.phoenix for r in _table() if r.phoenix]
        )
    return row.phoenix


def catalog_slug(value: str) -> str:
    """The canonical kebab-case slug."""
    return resolve(value).catalog


def scoring_slug(value: str) -> str:
    """The snake_case ``ExerciseSlug``. Raises when the exercise has no scoring config."""
    row = resolve(value)
    if row.scoring is None:
        raise UnknownExercise(
            value, "scoring", [r.scoring for r in _table() if r.scoring]
        )
    return row.scoring
