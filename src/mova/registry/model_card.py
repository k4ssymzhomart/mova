"""Transparent model cards (Mitchell et al. 2019) generated from registry entries.

A card is plain Markdown — intended use, training data, **honest** evaluation (the real numbers,
including where the model fails), and limitations — so the Model / Research surfaces render directly
from a source of truth and nothing is hand-typed. Written under ``data_manifests/model_cards/``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEFAULT_CARD_DIR = Path("data_manifests/model_cards")


def _fmt(v: Any) -> str:
    if isinstance(v, float):
        return f"{v:.3f}"
    return str(v)


def _metrics_table(metrics: dict[str, Any]) -> str:
    rows = ["| Metric | Value |", "|---|---|"]
    for k, v in metrics.items():
        if isinstance(v, dict) and "mean" in v:
            rows.append(f"| {k} | {v['mean']:.3f} ± {v.get('std', 0):.3f} |")
        elif not isinstance(v, (dict, list)):
            rows.append(f"| {k} | {_fmt(v)} |")
    return "\n".join(rows)


def render_card(entry: dict) -> str:
    e = entry
    td = e.get("training_data", {})
    prov = e.get("provenance", {})
    arts = e.get("artifacts", {})
    limitations = prov.get("limitations", [])
    lim_md = "\n".join(f"- {x}" for x in limitations) or "- See the metrics report for failure analysis."
    return f"""# Model Card — {e['model_id']}

**Task:** {e['task']}  ·  **Created:** {e.get('created_utc', '?')}  ·  **Commit:** `{e.get('git_sha', '?')}`

{e.get('description', '')}

## Intended use
{prov.get('intended_use', 'Research / decision-support only. Not a diagnostic device; outputs are surrogate estimates that support, never replace, a clinician.')}

## Architecture
- Encoder: LIMU-BERT transformer, hidden={e.get('encoder', {}).get('hidden', '?')}, layers={e.get('encoder', {}).get('n_layers', '?')}
- SSL pretraining: {td.get('ssl_pretraining', 'n/a')}

## Training data
- Datasets: {', '.join(td.get('datasets', [])) or '?'}
- Protocol: {td.get('protocol', '?')}
- Leakage control: {td.get('leakage_control', '?')}

## Evaluation (honest)
{_metrics_table(e.get('metrics', {}))}

Baseline to beat: AUROC {td.get('baseline_auroc', 0.551)} (single-subject, no SSL, plain CE).

## Limitations & failure modes
{lim_md}

## Artifacts
- Checkpoint: `{arts.get('checkpoint', 'n/a')}`
- ONNX: `{arts.get('onnx', 'n/a')}`
- Eval JSON: `{arts.get('eval_json', 'n/a')}`
"""


def write_card(entry: dict, card_dir: Path = DEFAULT_CARD_DIR) -> Path:
    card_dir.mkdir(parents=True, exist_ok=True)
    path = card_dir / f"{entry['model_id']}.md"
    path.write_text(render_card(entry))
    return path


def write_all_from_registry(registry_path: Path, card_dir: Path = DEFAULT_CARD_DIR) -> list[Path]:
    models = json.loads(Path(registry_path).read_text())["models"]
    return [write_card(m, card_dir) for m in models]
