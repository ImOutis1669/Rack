import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import upsert_listings
from rack.models import ListingRow
from rack.sources.ebay import parse_search
from rack.worker.taste import embed_listings, embed_taste, rescore
from tests.conftest import login
from tests.fakes import FakeEmbedder, png

pytestmark = pytest.mark.db

FIXTURE = Path(__file__).parent / "fixtures" / "ebay" / "search_sample.json"
H = {"X-Requested-With": "rack"}
COLOURS = {"AAA": "white", "DDD": "black"}


async def fetch(url: str) -> bytes:
    key = next(k for k in COLOURS if k in url)
    return png(COLOURS[key])


async def seed(sessions: async_sessionmaker[AsyncSession]) -> None:
    async with sessions() as s:
        await upsert_listings(s, parse_search(json.loads(FIXTURE.read_text(encoding="utf-8"))))
        await s.commit()


async def pipeline(sessions: async_sessionmaker[AsyncSession], uploads: Path) -> int | None:
    emb = FakeEmbedder()
    await embed_taste(sessions, emb, uploads)
    await embed_listings(sessions, emb, fetch)
    return await rescore(sessions, emb)


async def test_profile_roundtrip_bumps_version(client: httpx.AsyncClient) -> None:
    await login(client)
    r = await client.get("/api/profile")
    assert r.status_code == 200 and r.json()["version"] == 1
    body = r.json()["profile"]
    body["measurements"]["inseam_min_cm"] = 88
    body["context"] = "dark, draped, long silhouettes"
    r = await client.put("/api/profile", json=body, headers=H)
    assert r.json()["version"] == 2
    assert r.json()["profile"]["measurements"]["inseam_min_cm"] == 88


async def test_designers_seed_adjacent(client: httpx.AsyncClient) -> None:
    await login(client)
    r = await client.put(
        "/api/designers",
        json=[{"name": "Rick Owens", "weight": "love"}, {"name": "Gucci", "weight": "exclude"}],
        headers=H,
    )
    assert [d["name"] for d in r.json()] == ["Rick Owens", "Gucci"]
    adj = (await client.get("/api/adjacent")).json()
    assert "Julius" in adj["Rick Owens"] and "Gucci" not in adj


async def test_taste_upload_text_and_delete(client: httpx.AsyncClient, tmp_path: Path) -> None:
    await login(client)
    r = await client.post(
        "/api/taste/upload",
        data={"kind": "wardrobe", "text": "black tee"},
        files=[("files", ("a.png", png("black"), "image/png"))],
        headers=H,
    )
    assert r.status_code == 200, r.text
    item = r.json()[0]
    assert item["image"] and item["embedded"] is False
    img = await client.get(item["image"])
    assert img.headers["content-type"] == "image/jpeg"
    assert len(list((tmp_path / "data" / "uploads").iterdir())) == 1

    bad = await client.post(
        "/api/taste/upload",
        data={"kind": "wardrobe"},
        files=[("files", ("x.png", b"nope", "image/png"))],
        headers=H,
    )
    assert bad.status_code == 400

    r = await client.post(
        "/api/taste/text", json={"kind": "wishlist", "text": "tabi boots"}, headers=H
    )
    assert r.status_code == 200
    assert len((await client.get("/api/taste")).json()) == 2

    assert (await client.delete(f"/api/taste/{item['id']}", headers=H)).status_code == 204
    assert list((tmp_path / "data" / "uploads").iterdir()) == []


async def test_taste_url_rejects_private_hosts(client: httpx.AsyncClient) -> None:
    await login(client)
    r = await client.post(
        "/api/taste/url", json={"kind": "wishlist", "url": "http://127.0.0.1:8000/x.jpg"}, headers=H
    )
    assert r.status_code == 400


async def test_rank_feedback_hide_save_and_seen(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    await login(client)
    await seed(sessions)
    uploads = tmp_path / "data" / "uploads"
    await client.post(
        "/api/taste/upload",
        data={"kind": "wardrobe", "note": "black tee"},
        files=[("files", ("a.png", png("black"), "image/png"))],
        headers=H,
    )
    await client.put("/api/designers", json=[{"name": "Rick Owens", "weight": "love"}], headers=H)

    assert await pipeline(sessions, uploads) == 2
    assert await rescore(sessions, FakeEmbedder()) is None  # nothing changed -> skipped

    feed = (await client.get("/api/feed")).json()["items"]
    assert [i["title"].split()[0] for i in feed] == ["Rick", "Maison"]
    top = feed[0]
    assert "Looks like your black tee" in top["why"] and "Rick Owens (love)" in top["why"]
    assert top["category"] == "tops"

    # 👍 bumps the profile version, so the next run rescores
    r = await client.post(f"/api/listings/{top['id']}/feedback", json={"value": 1}, headers=H)
    assert r.status_code == 204
    assert await rescore(sessions, FakeEmbedder()) == 2
    assert (await client.get("/api/feed")).json()["items"][0]["feedback"] == 1

    # save
    assert (await client.put(f"/api/listings/{top['id']}/saved", headers=H)).status_code == 204
    saved = (await client.get("/api/saved")).json()
    assert saved[0]["id"] == top["id"] and saved[0]["price_gbp_at_save"] is not None

    # hide the brand -> filtered out after rescoring, in every sort (eBay seed has no sellers:
    # hidden sellers are covered by test_ranking and the hunt tests)
    assert feed[1]["seller"] is None  # no eBay user data
    async with sessions() as s:  # the search summary has no brand field
        await s.execute(
            update(ListingRow).where(ListingRow.id == feed[1]["id"]).values(brand="Maison Margiela")
        )
        await s.commit()
    await client.post("/api/hidden", json={"kind": "brand", "value": "maison margiela"}, headers=H)
    await rescore(sessions, FakeEmbedder())
    for sort in ("best", "newest", "price_asc"):
        items = (await client.get(f"/api/feed?sort={sort}")).json()["items"]
        assert [i["id"] for i in items] == [top["id"]], sort

    # seen in an earlier visit -> hidden
    v = (await client.post("/api/visit", headers=H)).json()
    assert v["visit_start"]
    await client.post("/api/seen", json={"ids": [top["id"]]}, headers=H)
    later = (datetime.now(UTC) + timedelta(minutes=1)).isoformat()
    r = await client.get("/api/feed", params={"hide_seen_before": later})
    assert r.json()["items"] == []


async def test_saving_trains_the_preference_vector(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    from sqlalchemy import select

    from rack.models import ListingScoreRow

    await login(client)
    await seed(sessions)
    await client.post(
        "/api/taste/upload",
        data={"kind": "wardrobe", "note": "black tee"},
        files=[("files", ("a.png", png("black"), "image/png"))],
        headers=H,
    )
    assert await pipeline(sessions, tmp_path / "data" / "uploads") == 2

    async def components() -> list[dict[str, float]]:
        async with sessions() as s:
            return [r.components for r in (await s.execute(select(ListingScoreRow))).scalars()]

    assert all("feedback" not in c for c in await components())

    feed = (await client.get("/api/feed")).json()["items"]
    r = await client.put(f"/api/listings/{feed[-1]['id']}/saved", headers=H)
    assert r.status_code == 204
    # saving bumps the profile version, and the saved item now counts as a like
    assert await rescore(sessions, FakeEmbedder()) == 2
    assert all("feedback" in c for c in await components())

    # unsaving takes it back out
    await client.delete(f"/api/listings/{feed[-1]['id']}/saved", headers=H)
    assert await rescore(sessions, FakeEmbedder()) == 2
    assert all("feedback" not in c for c in await components())
