"""FoG prediction routes: a POST endpoint and a streaming WebSocket.

Both accept raw 6-channel IMU windows and return the standard prediction payload. While the real model
is offline, requests are served by the deterministic mock engine (``MODEL_MODE=mock``).
"""

from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.schemas import FogPrediction, FogWindow
from app.services.mock_engine import predict_fog

router = APIRouter(prefix="/api/v1/predict", tags=["predict"])


@router.post("/fog", response_model=FogPrediction)
async def predict_fog_route(payload: FogWindow) -> FogPrediction:
    """Score a single IMU window for freezing-of-gait."""
    result = predict_fog(payload.window, payload.sampling_rate)
    return FogPrediction(**result)


@router.websocket("/fog/stream")
async def predict_fog_stream(ws: WebSocket) -> None:
    """Stream windows in, predictions out. Each message: ``{"window": [[...6]], "sampling_rate": 50}``."""
    await ws.accept()
    try:
        while True:
            msg = await ws.receive_json()
            window = msg.get("window")
            if window is None:
                await ws.send_json({"error": "missing 'window'"})
                continue
            try:
                result = predict_fog(window, float(msg.get("sampling_rate", 50.0)))
            except ValueError as exc:
                await ws.send_json({"error": str(exc)})
                continue
            await ws.send_json(result)
    except WebSocketDisconnect:
        return
