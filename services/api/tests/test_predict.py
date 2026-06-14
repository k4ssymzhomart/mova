"""Route-level tests for the FoG prediction API (no DB needed)."""

from __future__ import annotations

import numpy as np
from app.routers.predict import router
from fastapi import FastAPI
from fastapi.testclient import TestClient

app = FastAPI()
app.include_router(router)
client = TestClient(app)


def test_predict_fog_returns_contract() -> None:
    window = np.random.default_rng(0).standard_normal((200, 6)).tolist()
    resp = client.post("/api/v1/predict/fog", json={"window": window, "sampling_rate": 50})
    assert resp.status_code == 200
    body = resp.json()
    assert {"is_fog", "confidence", "timestamp"} <= body.keys()
    assert isinstance(body["is_fog"], bool)
    assert 0.0 <= body["confidence"] <= 1.0


def test_predict_fog_rejects_bad_shape() -> None:
    resp = client.post("/api/v1/predict/fog", json={"window": [[0.0, 1.0, 2.0]]})  # 3 channels
    assert resp.status_code == 422


def test_freeze_band_signal_flags_fog() -> None:
    # 5 Hz tremor (freeze band) riding on gravity (vertical axis) -> magnitude keeps the 5 Hz -> FoG.
    t = np.arange(200) / 50.0
    az = 1.0 + 0.3 * np.sin(2 * np.pi * 5.0 * t)
    zeros = np.zeros_like(t)
    window = np.stack([zeros, zeros, az, zeros, zeros, zeros], axis=1)
    resp = client.post("/api/v1/predict/fog", json={"window": window.tolist(), "sampling_rate": 50})
    body = resp.json()
    assert body["is_fog"] is True
    assert body["freeze_index"] > 1.5
