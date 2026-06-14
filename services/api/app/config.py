"""Runtime settings (12-factor; values come from the environment / compose)."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://mova:mova@db:5432/mova"
    model_mode: str = "mock"  # mock | live (live = real GPU-served model, future)
    cors_origins: list[str] = ["http://localhost:3000"]


settings = Settings()
