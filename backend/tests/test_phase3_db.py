from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import record_check, upsert_listings
from rack.sources.base import Listing
from rack.worker.taste import assign_clusters, embed_listings, rescore
from tests.conftest import login
from tests.fakes import FakeEmbedder, png

pytestmark = pytest.mark.db


def listing(source: str, sid: str, price: str, img: str) -> Listing:
    return Listing(
        source=source,
        source_id=sid,
        url=f"https://{source}.example/{sid}",
        title=f"Black tee {sid}",
        price=Decimal(price),
        currency="GBP",
        price_gbp=Decimal(price),
        images=[f"https://img.example/{img}.jpg"],
        listed_at=datetime.now(UTC),
    )


async def fetch(url: str) -> bytes:
    return png("black" if "same" in url else "red", (64, 64))


async def test_cross_listed_item_shows_once_with_all_buy_links(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    await login(client)
    async with sessions() as s:
        await upsert_listings(
            s,
            [
                listing("ebay", "1", "120", "same-a"),
                listing("vinted", "2", "95", "same-b"),
                listing("grailed", "3", "60", "different"),
            ],
        )
        await s.commit()
    emb = FakeEmbedder()
    await embed_listings(sessions, emb, fetch)
    assert await assign_clusters(sessions) == 2
    await rescore(sessions, emb)

    items = (await client.get("/api/feed?sort=newest")).json()["items"]
    assert len(items) == 2
    merged = next(i for i in items if len(i["buy_links"]) == 2)
    assert merged["source"] == "vinted"  # cheapest copy represents the cluster
    assert [b["source"] for b in merged["buy_links"]] == ["vinted", "ebay"]


async def test_blocked_source_health(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await login(client)
    async with sessions() as s:
        await record_check(
            s, "vestiaire", blocked=True, detail="Blocked by the site's bot protection"
        )
        await s.commit()
    health = {h["source"]: h for h in (await client.get("/api/sources/health")).json()}
    assert health["vestiaire"]["status"] == "blocked"
    assert health["vestiaire"]["last_check_at"]
