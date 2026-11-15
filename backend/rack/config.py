"""Application settings, read from environment / .env."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"), env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = "postgresql+asyncpg://rack:rack@localhost:5432/rack"

    # Auth
    rack_password_hash: str = ""
    rack_session_secret: str = ""
    rack_cookie_secure: bool = True
    rack_session_days: int = 30
    rack_public_url: str = "http://localhost:8000"

    # eBay
    ebay_client_id: str = ""
    ebay_client_secret: str = ""
    ebay_marketplace: str = "EBAY_GB"

    # Rate limits (seconds between requests, per source)
    rate_ebay: float = 2.0
    rate_vinted: float = 10.0
    rate_grailed: float = 10.0
    rate_vestiaire: float = 15.0

    # Worker
    rack_refresh_minutes: int = 30
    # Phase 1 only: plain queries until the taste-driven planner exists (Phase 2).
    rack_seed_queries: str = "maison margiela,rick owens,our legacy"

    static_dir: Path = Field(default=Path(__file__).resolve().parent.parent / "static")

    @property
    def seed_queries(self) -> list[str]:
        return [q.strip() for q in self.rack_seed_queries.split(",") if q.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
