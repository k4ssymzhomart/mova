"""Runtime settings (12-factor; values come from the environment / compose)."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://mova:mova@db:5432/mova"
    model_mode: str = "mock"  # mock | live (live = real GPU-served model, future)
    cors_origins: list[str] = ["http://localhost:3000"]
    # Preview deployments get a fresh origin per commit, so they can't be enumerated in the list
    # above. Set a regex (e.g. ``https://mova-[a-z0-9-]+\.vercel\.app``) to admit that family too.
    cors_origin_regex: str | None = None


settings = Settings()
