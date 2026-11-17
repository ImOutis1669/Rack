from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import upsert_listings
from rack.models import PriceObservationRow
from rack.pricing import fx
from rack.pricing.history import first_prices, price_cut
from rack.pricing.landed import estimate, ships_from_uk
from rack.profile import Profile, Weights
from rack.ranking.explain import explain
from rack.ranking.scoring import ListingFeatures, TasteContext, score_all
from rack.ranking.vectors import as_matrix
from rack.sources.base import Listing
from tests.conftest import login

D = Decimal


async def test_fx_parses_frankfurter_and_falls_back() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.url.params["base"] == "GBP"
        return httpx.Response(
            200, json={"base": "GBP", "date": "2026-11-13", "rates": {"USD": 1.25, "EUR": 1.2}}
        )

    date, rates = await fx.fetch_rates(httpx.MockTransport(handler))
    assert date == "2026-11-13" and rates["USD"] == D("0.8") and rates["GBP"] == 1
    try:
        fx.set_live_rates(rates)
        assert fx.to_gbp(D(100), "USD") == D("80.00")
        assert fx.to_gbp(D(100), "JPY") == D("0.51")  # not in live table: static fallback
    finally:
        fx.set_live_rates(None)
    assert fx.to_gbp(D(100), "USD") == D("77.00")


def test_landed_cost_rules() -> None:
    uk = estimate(source="vinted", price_gbp=D(80), shipping_gbp=None, country="GB", location=None)
    assert uk and uk.total_gbp == D(80) and not uk.imported and "postage not included" in uk.notes

    low = estimate(
        source="grailed",
        price_gbp=D(100),
        shipping_gbp=D(20),
        country="US",
        location="United States",
    )
    assert low and low.imported and low.vat_gbp == D("24.00") and low.duty_gbp == 0
    assert low.total_gbp == D("144.00")

    high = estimate(
        source="grailed", price_gbp=D(400), shipping_gbp=D(30), country=None, location="Europe"
    )
    assert (
        high and high.duty_gbp == D("51.60") and high.vat_gbp == D("96.32") and high.fee_gbp == 12
    )
    assert high.total_gbp == D("589.92")

    assert (
        estimate(source="ebay", price_gbp=D(10), shipping_gbp=None, country=None, location=None)
        is None
    )
    assert ships_from_uk("grailed", None, "United Kingdom") is True


def test_price_cut_threshold() -> None:
    assert price_cut(D(200), D(180)) == D(200)
    assert price_cut(D(200), D(195)) is None
    assert price_cut(None, D(1)) is None


def test_price_cut_lifts_deal_and_explains() -> None:
    e = as_matrix([[1.0, 0, 0, 0]], dim=4)
    ctx = TasteContext(Profile(), {}, as_matrix([], dim=4), [], as_matrix([], dim=4), [])
    a, b = score_all(
        [
            ListingFeatures(
                1, "Coat", None, None, None, 150.0, None, e, None, first_price_gbp=200.0
            ),
            ListingFeatures(
                2, "Coat", None, None, None, 150.0, None, e, None, first_price_gbp=150.0
            ),
        ],
        ctx,
    )
    assert a.components["deal"] > b.components["deal"] == 0.5
    assert a.details["was_gbp"] == 200.0
    assert "Price cut (was £200)" in explain(a.components, a.details, Weights())


def listing(price: str) -> Listing:
    return Listing(
        source="grailed",
        source_id="77",
        url="https://www.grailed.com/listings/77",
        title="Lemaire coat",
        price=D(price),
        currency="GBP",
        price_gbp=D(price),
        location="United States",
        shipping_cost=D(20),
    )


@pytest.mark.db
async def test_history_and_api_fields(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await login(client)
    async with sessions() as s:
        [lid] = await upsert_listings(s, [listing("200")])
        await upsert_listings(s, [listing("200")])  # unchanged: no new observation
        await s.commit()
        # make the first observation clearly older
        obs = (await s.execute(select(PriceObservationRow))).scalars().all()
        assert len(obs) == 1
        obs[0].observed_at = datetime.now(UTC) - timedelta(days=3)
        await upsert_listings(s, [listing("150")])
        await s.commit()
        assert await first_prices(s, [lid]) == {lid: D("200.00")}

    [item] = (await client.get("/api/feed?sort=newest")).json()["items"]
    assert D(item["was_price_gbp"]) == D(200)
    landed = item["landed"]
    assert landed["imported"] is True
    # £150 + £20 post is over £135: duty 12%, VAT 20%, £12 fee
    assert D(landed["total_gbp"]) == D("240.48")
