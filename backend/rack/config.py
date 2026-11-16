"""Application settings, read from environment / .env."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Docker gives each container only its own secrets file; local dev reads them all.
        env_file=(
            ".env",
            "../.env",
            "../.env.api",
            "../.env.worker",
        ),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+asyncpg://rack:rack@localhost:5432/rack"

    # Auth
    rack_password_hash: str = ""
    rack_session_secret: str = ""
    rack_cookie_secure: bool = True
    rack_session_days: int = 30
    rack_public_url: str = "http://localhost:8000"
    # Only these hosts may tell us the real client IP (CF-Connecting-IP): the tunnel container.
    rack_trusted_proxies: str = "cloudflared"

    # eBay
    ebay_client_id: str = ""
    ebay_client_secret: str = ""
    ebay_marketplace: str = "EBAY_GB"

    # Grailed: public search-only Algolia key that grailed.com ships to browsers
    grailed_algolia_app_id: str = ""
    grailed_algolia_api_key: str = ""

    # Vestiaire via a paid Apify actor (residential proxies). Billed per result, so it runs on its
    # own slow schedule with hard caps. ~$25 per 1,000 results at time of writing.
    apify_token: str = ""
    vestiaire_refresh_hours: float = 24
    vestiaire_queries_per_run: int = 3
    vestiaire_max_results: int = 10  # per query
    vestiaire_monthly_result_cap: int = 300
    vestiaire_enrich: bool = False  # full descriptions + galleries; slower

    # Optional LLM re-rank (Claude). Off by default; the app is complete without it.
    llm_enabled: bool = False
    anthropic_api_key: str = ""
    llm_model: str = "claude-opus-5-5"
    llm_top_n: int = 30
    llm_daily_call_cap: int = 12
    llm_verdict_days: float = 3
    llm_weight: float = 0.3  # how far a verdict can move a score: ± weight/2

    # Notifications. ntfy: phone app subscribes to the topic (the topic name is the secret).
    ntfy_url: str = "https://ntfy.sh"
    ntfy_topic: str = ""
    ntfy_token: str = ""  # only for protected/self-hosted servers
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    # Web Push to the installed app: generate with `rack vapid-keys`
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    rack_price_check_hours: float = 6
    # Landed-cost estimate for imports (see rack/pricing/landed.py)
    landed_duty_rate: float = 0.12
    landed_handling_fee_gbp: float = 12.0
    rack_price_drop_min_pct: float = 5.0
    rack_price_drop_min_gbp: float = 5.0

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
    rack_manual_refresh_cooldown_minutes: int = 5
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
