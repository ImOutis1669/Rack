"""Builds the enabled source adapters from settings."""

from rack.config import Settings
from rack.sources.base import SourceAdapter
from rack.sources.ebay import EbayAdapter

SOURCE_NAMES = ("ebay", "vinted", "grailed", "vestiaire")


def build_adapters(settings: Settings) -> list[SourceAdapter]:
    return [
        EbayAdapter(
            settings.ebay_client_id,
            settings.ebay_client_secret,
            marketplace=settings.ebay_marketplace,
            min_interval=settings.rate_ebay,
        ),
    ]
