"""Vercel Serverless Function entrypoint for the Mova inference API.

Vercel's Python runtime serves any module under `api/` that exports an ASGI `app`. The application
itself lives in `services/api/app` — the exact code the Dockerfile runs under uvicorn — so this file
only adapts it to the platform:

  1. `sys.path`: Python puts the *function's* directory on the path, not the project root, so `app`
     would otherwise be unimportable.
  2. Path restoration: every request is rewritten to this one function (`vercel.json`), which means
     the ASGI scope arrives carrying the rewrite destination instead of what the client asked for.
     The rewrite therefore smuggles the original path through in a `__path` query parameter, and
     `_restore_path` puts it back before FastAPI routes the request.

WebSockets are not available on serverless functions, so on Vercel only `POST /api/v1/predict/fog`
is reachable; `/api/v1/predict/fog/stream` still works wherever this code runs under uvicorn.
"""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode

# services/api — the package root that holds `app/`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app as fastapi_app  # noqa: E402  (path must be set before this import)

ORIGINAL_PATH_PARAM = "__path"


async def app(scope, receive, send):  # noqa: ANN001, ANN201 — ASGI signature
    """ASGI entrypoint: restore the client's path, then hand off to FastAPI unchanged."""
    if scope["type"] == "http":
        scope = _restore_path(scope)
    await fastapi_app(scope, receive, send)


def _restore_path(scope: dict) -> dict:
    """Move `?__path=…` back onto `scope["path"]`, dropping it from the visible query string.

    A no-op when the parameter is absent, so the same module still serves a plain `uvicorn
    api.index:app` locally.
    """
    params = parse_qsl(scope.get("query_string", b"").decode("latin-1"), keep_blank_values=True)
    original = next((v for k, v in params if k == ORIGINAL_PATH_PARAM), None)
    if original is None:
        return scope

    path = original if original.startswith("/") else f"/{original}"
    rest = [(k, v) for k, v in params if k != ORIGINAL_PATH_PARAM]
    scope = dict(scope)
    scope["path"] = path
    scope["raw_path"] = path.encode("utf-8")
    scope["query_string"] = urlencode(rest).encode("latin-1")
    return scope
