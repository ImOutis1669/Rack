"""One shared adapter (and so one rate-limited HTTP client) per source for the whole worker.

The refresh, hunts and price-drop jobs all go through these, so "one request in flight per source,
N seconds apart" holds across jobs, not just within one.
"""

from rack.config import get_settings
from rack.sources.base import SourceAdapter
from rack.sources.registry import build_adapters

_adapters: dict[str, SourceAdapter] | None = None


def shared_adapters() -> dict[str, SourceAdapter]:
    global _adapters
    if _adapters is None:
        _adapters = {a.name: a for a in build_adapters(get_settings())}
    return _adapters
