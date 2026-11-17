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
    # Creates the owner account the first time anyone logs in (v2.1); after that the password
    # lives in the users table (change it in the app, or `rack reset-password <username>`).
    rack_password_hash: str = ""
    rack_owner_username: str = "owner"
    rack_invite_days: int = 7
    # Friends' caps (the owner has none): hunts share eBay's daily quota and the sources' rate
    # limits; sold-price checks hit Grailed once a day per branded wardrobe item.
    rack_friend_max_hunts: int = 5
    rack_friend_min_hunt_minutes: int = 60
    rack_friend_sold_items: int = 30
    # When only listings changed, friends' feeds are rescored at most this often (the owner's
    # at once). Their own taste changes still rescore them at once.
    rack_friend_rescore_minutes: int = 10
    # Live search (search the marketplaces now): seconds between one person's searches, and how
    # many may wait in the queue at once
    rack_live_search_owner_seconds: int = 30
    rack_live_search_friend_seconds: int = 120
    rack_live_search_queue: int = 5
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
    # "I do not persist eBay data": delete eBay listings inactive or unseen for this long
    rack_ebay_retention_days: float = 7
    # cached WebP thumbnails (rack/thumbs.py): pruned by age (eBay photos too) and total size
    rack_thumbs_max_age_days: float = 7
    rack_thumbs_max_mb: int = 1024
    # getItem lookups for new eBay listings (size, brand, department): per eBay day / per run
    rack_ebay_details_daily_cap: int = 1000
    rack_ebay_details_batch: int = 20
    ebay_daily_call_limit: int = 5000  # eBay's Browse quota (search), for the health display

    # Grailed: public search-only Algolia key that grailed.com ships to browsers
    grailed_algolia_app_id: str = ""
    grailed_algolia_api_key: str = ""

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
    rate_images: float = 0.25  # listing thumbnails from marketplace image CDNs (embedding only)

    # Embeddings (worker only)
    clip_model: str = "ViT-B-32"
    clip_pretrained: str = "laion2b_s34b_b79k"
    rack_embed_images_per_listing: int = 1
    rack_data_dir: Path = Path("data")

    # Worker
    rack_refresh_minutes: int = 30
    rack_queries_per_refresh: int = 12
    # The Refresh button searches only the asking person's own taste (loved designers first, then
    # wishlist, then the rest), a short batch so results land in under a minute. Cooldowns are
    # per person; one refresh runs at a time.
    rack_manual_queries: int = 4
    rack_score_seconds: int = 60
    rack_manual_refresh_cooldown_minutes: int = 5
    rack_friend_refresh_cooldown_minutes: int = 15
    # Used only until you've added designers / wishlist text.
    rack_seed_queries: str = "maison margiela,rick owens,our legacy"

    static_dir: Path = Field(default=Path(__file__).resolve().parent.parent / "static")
    # Owner-only licensed assets (fonts, Basil icons): frontend/private locally, /app/private in
    # Docker. Served only to the owner, never in the public bundle.
    rack_private_dir: Path = Field(
        default=Path(__file__).resolve().parent.parent.parent / "frontend" / "private"
    )

    @property
    def uploads_dir(self) -> Path:
        return self.rack_data_dir / "uploads"

    @property
    def seed_queries(self) -> list[str]:
        return [q.strip() for q in self.rack_seed_queries.split(",") if q.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
