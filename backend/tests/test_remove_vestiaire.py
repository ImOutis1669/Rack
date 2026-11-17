"""Vestiaire Collective is gone (v1.2): only eBay, Vinted and Grailed remain."""

import importlib.util
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.config import Settings
from rack.embeddings.images import is_listing_image_host
from rack.models import AppStateRow, HuntRow, ListingImageRow, ListingRow, SourceHealthRow
from rack.sources.registry import SOURCE_NAMES, build_adapters

MIGRATION = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "0018_remove_vestiaire.py"


def test_only_three_sources() -> None:
    assert SOURCE_NAMES == ("ebay", "vinted", "grailed")
    assert [a.name for a in build_adapters(Settings())] == ["ebay", "vinted", "grailed"]
    assert not hasattr(Settings(), "apify_token")
    assert not is_listing_image_host("https://images.vestiairecollective.com/x.jpg")


@pytest.mark.db
async def test_migration_0018_removes_vestiaire_data(sessions: async_sessionmaker[AsyncSession]) -> None:
    now = datetime.now(UTC)
    async with sessions() as s:
        v = ListingRow(source="vestiaire", source_id="1", url="https://www.vestiairecollective.com/1",
                       title="Coat", price=Decimal("1"), currency="GBP", first_seen_at=now, last_seen_at=now)
        g = ListingRow(source="grailed", source_id="2", url="https://www.grailed.com/listings/2",
                       title="Tee", price=Decimal("1"), currency="GBP", first_seen_at=now, last_seen_at=now)
        s.add_all([v, g])
        await s.flush()
        s.add(ListingImageRow(listing_id=v.id, position=0, url="https://x/v.jpg", url_hash="v"))
        s.add(SourceHealthRow(source="vestiaire"))
        s.add(AppStateRow(key="recheck", value={"at": "x"}))
        s.add(HuntRow(name="Rick", query="rick", sources=["vinted", "vestiaire"]))
        await s.commit()

    spec = importlib.util.spec_from_file_location("m0018", MIGRATION)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    async with sessions() as s:
        conn = await s.connection()

        def run(sync_conn) -> None:  # type: ignore[no-untyped-def]
            with Operations.context(MigrationContext.configure(sync_conn)):
                m.upgrade()

        await conn.run_sync(run)
        await s.commit()

        assert [r.source for r in (await s.execute(select(ListingRow))).scalars()] == ["grailed"]
        assert (await s.execute(select(ListingImageRow))).first() is None  # cascaded
        assert await s.get(SourceHealthRow, "vestiaire") is None
        assert await s.get(AppStateRow, "recheck") is None
        hunt = (await s.execute(select(HuntRow))).scalar_one()
        assert hunt.sources == ["vinted"]
