"""Lazy async engine + a connectivity ping for the health check.

The engine is created on first use so the app imports cleanly without a live database (e.g. in unit
tests of the prediction routes).
"""

from __future__ import annotations

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import settings

PING_TIMEOUT_S = 2.0

_engine: AsyncEngine | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    return _engine


async def ping(timeout: float = PING_TIMEOUT_S) -> bool:
    """Return True if a ``SELECT 1`` round-trips to the database inside ``timeout`` seconds.

    Bounded because the health check runs on hosts with no database reachable at all (serverless
    functions, CI): without a deadline an unroutable ``DATABASE_URL`` would hang the request until the
    platform's own timeout instead of reporting ``degraded``.
    """

    async def _probe() -> bool:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True

    try:
        return await asyncio.wait_for(_probe(), timeout)
    except Exception:  # includes the TimeoutError wait_for raises
        return False


async def dispose() -> None:
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None
