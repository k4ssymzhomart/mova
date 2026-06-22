"""End-to-end data-platform test on synthetic fixtures.

Runs the whole DAG — every adapter -> canonical interim -> 50 Hz windows -> subject-disjoint
splits -> LOSO folds -> leakage gate -> pose features -> flywheel — and asserts windows are
produced and the splits are leakage-free. This is the runnable proof of the Phase-2 DoD
("reproducible from one command; leakage = 0") without the gated multi-GB downloads.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tests" / "fixtures"))

import make_fixtures  # noqa: E402

from mova.data import leakage  # noqa: E402
from mova.data.adapters import (  # noqa: E402
    amass_adapter,
    capture24_adapter,
    daphnet_adapter,
    dip_imu_adapter,
    hhar_adapter,
    kimore_adapter,
    realdisp_adapter,
    totalcapture_adapter,
    uiprmd_adapter,
)
from mova.flywheel import etl  # noqa: E402
from mova.pose import pipeline as pose_pipeline  # noqa: E402
from mova.preprocess import loso, pipeline  # noqa: E402

SCHEMA = str(REPO / "data_manifests" / "schemas" / "canonical.json")

IMU_ADAPTERS = [
    (capture24_adapter, "capture24"),
    (totalcapture_adapter, "totalcapture"),
    (dip_imu_adapter, "dip_imu"),
    (hhar_adapter, "hhar"),
    (daphnet_adapter, "daphnet_fog"),
    (realdisp_adapter, "realdisp"),
]


def _build_interim(raw: Path, interim: Path) -> None:
    for mod, sub in IMU_ADAPTERS:
        assert mod.main(
            ["--raw-dir", str(raw / sub), "--out-dir", str(interim), "--schema", SCHEMA,
             "--log-level", "ERROR"]
        ) == 0
    # AMASS has its own CLI (no --schema) — virtual IMU from SMPL pose.
    assert amass_adapter.main(
        ["--raw-dir", str(raw / "amass"), "--out-dir", str(interim), "--log-level", "ERROR"]
    ) == 0


def test_full_pipeline_zero_leakage(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    make_fixtures.make_all(raw)
    interim = tmp_path / "interim"
    processed = tmp_path / "processed"
    manifests = tmp_path / "manifests"

    _build_interim(raw, interim)

    # preprocess writes norm_stats to a cwd-relative path — chdir so it lands in tmp.
    monkeypatch.chdir(tmp_path)
    assert pipeline.main(
        ["--interim", str(interim), "--out", str(processed),
         "--splits", str(manifests / "subject_splits.json"), "--shard-size", "5000",
         "--log-level", "ERROR"]
    ) == 0
    assert loso.main(
        ["--interim", str(interim), "--datasets", "daphnet_fog",
         "--out", str(manifests / "loso"), "--log-level", "ERROR"]
    ) == 0

    rc = leakage.main(
        ["--splits", str(manifests / "subject_splits.json"), "--loso", str(manifests / "loso"),
         "--processed", str(processed / "index.parquet"),
         "--out", str(manifests / "leakage_report.json"), "--log-level", "ERROR"]
    )
    assert rc == 0, "leakage check must exit 0"

    report = json.loads((manifests / "leakage_report.json").read_text())
    assert report["leakage_free"] is True
    assert report["total_leaks"] == 0

    meta = json.loads((processed / "meta.json").read_text())
    assert meta["total_windows"] > 0
    datasets = {d["dataset"] for d in meta["windows_by_dataset"]}
    # the four new IMU adapters must contribute windows alongside the original three
    assert {"capture24", "totalcapture", "dip_imu", "amass"} <= datasets
    assert {"hhar", "daphnet_fog", "realdisp"} <= datasets


def test_pose_pipeline_and_loso(tmp_path):
    raw = tmp_path / "raw"
    make_fixtures.make_all(raw)
    interim_pose = tmp_path / "interim_pose"
    assert kimore_adapter.main(
        ["--raw-dir", str(raw / "kimore"), "--out-dir", str(interim_pose), "--log-level", "ERROR"]
    ) == 0
    assert uiprmd_adapter.main(
        ["--raw-dir", str(raw / "ui_prmd"), "--out-dir", str(interim_pose), "--log-level", "ERROR"]
    ) == 0
    out = tmp_path / "processed_pose"
    assert pose_pipeline.main(["--interim", str(interim_pose), "--out", str(out), "--log-level", "ERROR"]) == 0

    import polars as pl

    feats = pl.read_parquet(out / "pose_features.parquet")
    assert feats.height > 0
    assert {"mean_smoothness", "mean_symmetry", "rom_deg"} <= set(feats.columns)

    folds = tmp_path / "loso_pose"
    assert loso.main(
        ["--interim", str(interim_pose), "--datasets", "kimore,ui_prmd", "--out", str(folds),
         "--log-level", "ERROR"]
    ) == 0
    assert (folds / "kimore.json").is_file()


def test_flywheel_etl(tmp_path):
    raw = tmp_path / "raw"
    make_fixtures.make_all(raw)
    out = tmp_path / "flywheel"
    manifest = etl.FlywheelETL(raw / "sessions", out, min_val_gain=0.0).run()
    assert manifest["n_sessions"] == 4
    # no model yet -> every candidate is gated PENDING (Phase 3 supplies evaluate_fn)
    assert manifest["pending"] == 4
    assert (out / "flywheel_manifest.json").is_file()
