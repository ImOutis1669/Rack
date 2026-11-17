"""Accessories as a category in every source (ids checked live 2026-11-17)."""

import importlib.util
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.models import SoldListingRow
from rack.ranking.filters import FIT_FIELDS
from rack.sources.base import Category, SearchQuery
from rack.sources.grailed import CATEGORY_FACETS, GRAILED_CATEGORIES
from rack.sources.vinted import CATALOG_IDS, build_search_params
from rack.store import get_profile_row


def test_every_category_is_mapped_everywhere() -> None:
    for cat in Category:
        assert cat in FIT_FIELDS and cat in CATEGORY_FACETS and cat in CATALOG_IDS


def test_grailed_menswear_accessories_facet() -> None:
    assert CATEGORY_FACETS[Category.ACCESSORIES] == ["category:accessories"]
    assert GRAILED_CATEGORIES["accessories"] == Category.ACCESSORIES  # sold comparables


def test_vinted_men_s_accessories_catalogue() -> None:
    params = build_search_params(SearchQuery(text="belt", category=Category.ACCESSORIES))
    assert ("catalog[]", "82") in params


def test_accessories_have_no_measurement_minimums() -> None:
    assert FIT_FIELDS[Category.ACCESSORIES] == ()


# --- migration 0017 (needs Docker) ---
MIGRATION = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "0017_accessories_category.py"


@pytest.mark.db
async def test_migration_0017_rescores_and_recategorises_sold_items(
    sessions: async_sessionmaker[AsyncSession],
    owner_id: int,
) -> None:
    async with sessions() as s:
        before = (await get_profile_row(s, owner_id)).version
        now = datetime.now(UTC)
        for sid, title, cat in (("1", "Chrome Hearts cross ring", "any"), ("2", "Rick Owens tee", "any"), ("3", "Belt", "tops")):
            s.add(SoldListingRow(source="grailed", source_id=sid, title=title, category=cat,
                                 sold_price_gbp=Decimal("100"), sold_at=now))
        await s.commit()

    spec = importlib.util.spec_from_file_location("m0017", MIGRATION)
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
        assert (await get_profile_row(s, owner_id)).version == before + 1  # the worker rescores everything
        cats = {r.source_id: r.category for r in (await s.execute(select(SoldListingRow))).scalars()}
        assert cats == {"1": "accessories", "2": "any", "3": "tops"}  # only "any" rows re-inferred
        assert (await s.execute(text("SELECT 1"))).scalar() == 1
