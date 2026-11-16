"""Wardrobe value (5a): purchase price and a value you type in, per wardrobe item."""

from decimal import Decimal

import httpx
import pytest

from tests.conftest import login

pytestmark = pytest.mark.db
H = {"X-Requested-With": "rack"}


async def _text_item(client: httpx.AsyncClient, kind: str = "wardrobe") -> int:
    r = await client.post(
        "/api/taste/text", json={"kind": kind, "text": "black overcoat"}, headers=H
    )
    assert r.status_code == 200, r.text
    return int(r.json()["id"])


async def test_set_and_clear_prices_without_rescoring(client: httpx.AsyncClient) -> None:
    await login(client)
    item = await _text_item(client)
    version = (await client.get("/api/profile")).json()["version"]

    r = await client.patch(
        f"/api/taste/{item}",
        json={"purchase_price_gbp": "180", "custom_value_gbp": "220.50"},
        headers=H,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert Decimal(body["purchase_price_gbp"]) == Decimal("180")
    assert Decimal(body["custom_value_gbp"]) == Decimal("220.50")
    assert body["text"] == "black overcoat"  # untouched
    assert (await client.get("/api/profile")).json()["version"] == version  # no rescore

    r = await client.patch(f"/api/taste/{item}", json={"custom_value_gbp": None}, headers=H)
    assert r.json()["custom_value_gbp"] is None
    assert Decimal(r.json()["purchase_price_gbp"]) == Decimal("180")  # only what was sent

    listed = (await client.get("/api/taste?kind=wardrobe")).json()
    assert Decimal(listed[0]["purchase_price_gbp"]) == Decimal("180")


async def test_rejects_bad_amounts(client: httpx.AsyncClient) -> None:
    await login(client)
    item = await _text_item(client)
    for bad in ("-1", "100000.01", "12.345", "lots"):
        r = await client.patch(f"/api/taste/{item}", json={"custom_value_gbp": bad}, headers=H)
        assert r.status_code == 422, bad


async def test_wishlist_items_have_no_value(client: httpx.AsyncClient) -> None:
    await login(client)
    item = await _text_item(client, "wishlist")
    r = await client.patch(f"/api/taste/{item}", json={"purchase_price_gbp": "10"}, headers=H)
    assert r.status_code == 400


async def test_editing_the_label_still_rescores(client: httpx.AsyncClient) -> None:
    await login(client)
    item = await _text_item(client)
    version = (await client.get("/api/profile")).json()["version"]
    await client.patch(f"/api/taste/{item}", json={"text": "grey overcoat"}, headers=H)
    assert (await client.get("/api/profile")).json()["version"] > version
