"""Vercel Serverless Function entrypoint for the Mova inference API.

Vercel detects this as a FastAPI project and routes every request to the module under `api/` that
exports an ASGI `app`, preserving the client's path — so no `rewrites` are needed (and adding one
would be actively harmful: an internal rewrite makes the function see the rewrite *destination*
instead of what the client asked for).

The application itself is untouched: `app.main:app` is the exact code the Dockerfile runs under
uvicorn. This module only fixes `sys.path`, because Python puts the *function's* directory on the
path rather than the project root, which would otherwise leave `app` unimportable.

WebSockets are not available on serverless functions, so on Vercel only `POST /api/v1/predict/fog`
is reachable; `/api/v1/predict/fog/stream` still works wherever this code runs under uvicorn.
"""

from __future__ import annotations

import sys
from pathlib import Path

# services/api — the package root that holds `app/`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app  # noqa: E402  (path must be set before this import)

__all__ = ["app"]
