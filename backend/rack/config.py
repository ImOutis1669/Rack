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

    # Grailed: public search-only Algolia key that grailed.com ships to browsers
    grailed_algolia_app_id: str = ""
    grailed_algolia_api_key: str = ""

    # Rate limits (seconds between requests, per source)
    rate_ebay: float = 2.0
    rate_vinted: float = 10.0
    rate_grailed: float = 10.0
    rate_vestiaire: float = 15.0
    rate_images: float = 1.0  # listing thumbnails from marketplace CDNs (embedding only)

    # Embeddings (worker only)
    clip_model: str = "ViT-B-32"
    clip_pretrained: str = "laion2b_s34b_b79k"
    rack_embed_images_per_listing: int = 1
    rack_data_dir: Path = Path("data")

    # Worker
    rack_refresh_minutes: int = 30
    rack_queries_per_refresh: int = 12
    rack_score_seconds: int = 60
    # Used only until you've added designers / wishlist text.
    rack_seed_queries: str = "maison margiela,rick owens,our legacy"

    static_dir: Path = Field(default=Path(__file__).resolve().parent.parent / "static")

    @property
    def uploads_dir(self) -> Path:
        return self.rack_data_dir / "uploads"

    @property
    def seed_queries(self) -> list[str]:
        return [q.strip() for q in self.rack_seed_queries.split(",") if q.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
