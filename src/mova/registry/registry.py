"""A small JSON-backed model registry.

One file (``data_manifests/model_registry.json``, kept in git) records every trained model: its
task, headline metrics, checkpoint / ONNX paths, training-data provenance, and the git commit it was
produced from. This is the source of truth the Benchmark / Model pages (Phase 8) render from — and
the honest paper trail behind each number.
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

DEFAULT_REGISTRY = Path("data_manifests/model_registry.json")


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], stderr=subprocess.DEVNULL
        ).decode().strip()
    except Exception:
        return "unknown"


@dataclass
class ModelEntry:
    model_id: str
    task: str
    description: str
    metrics: dict[str, Any]
    encoder: dict[str, Any]
    training_data: dict[str, Any]
    artifacts: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)
    created_utc: str = field(default_factory=lambda: datetime.now(UTC).isoformat())
    git_sha: str = field(default_factory=_git_sha)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class ModelRegistry:
    def __init__(self, path: Path = DEFAULT_REGISTRY) -> None:
        self.path = Path(path)
        self.entries: dict[str, dict] = {}
        if self.path.exists():
            self.entries = {e["model_id"]: e for e in json.loads(self.path.read_text())["models"]}

    def register(self, entry: ModelEntry) -> ModelEntry:
        self.entries[entry.model_id] = entry.as_dict()
        self.save()
        return entry

    def get(self, model_id: str) -> dict | None:
        return self.entries.get(model_id)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema": "mova-model-registry/v1",
            "updated_utc": datetime.now(UTC).isoformat(),
            "models": sorted(self.entries.values(), key=lambda e: e["model_id"]),
        }
        self.path.write_text(json.dumps(payload, indent=2))
