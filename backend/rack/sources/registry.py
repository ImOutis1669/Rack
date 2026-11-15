"""Builds the enabled source adapters from settings."""

from rack.config import Settings
from rack.sources.base import SourceAdapter
from rack.sources.ebay import EbayAdapter
from rack.sources.grailed import GrailedAdapter
from rack.sources.vinted import VintedAdapter

SOURCE_NAMES = ("ebay", "vinted", "grailed", "vestiaire")


def build_adapters(settings: Settings) -> list[SourceAdapter]:
    return [
        EbayAdapter(
            settings.ebay_client_id,
            settings.ebay_client_secret,
            marketplace=settings.ebay_marketplace,
            min_interval=settings.rate_ebay,
        ),
        VintedAdapter(min_interval=settings.rate_vinted),
        GrailedAdapter(
            settings.grailed_algolia_app_id,
            settings.grailed_algolia_api_key,
            min_interval=settings.rate_grailed,
        ),
    ]
