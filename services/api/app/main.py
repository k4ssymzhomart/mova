"""Mova API gateway — app factory, health check, and route wiring."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import session
from app.routers import predict


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await session.dispose()


app = FastAPI(title="Mova API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(predict.router)


@app.get("/", tags=["meta"])
async def root() -> dict[str, str]:
    return {"service": "mova-api", "version": "0.1.0", "docs": "/docs"}


@app.get("/health", tags=["meta"])
async def health() -> dict[str, object]:
    db_ok = await session.ping()
    return {
        "status": "ok" if db_ok else "degraded",
        "database": db_ok,
        "model_mode": settings.model_mode,
    }
