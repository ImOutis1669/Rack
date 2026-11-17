"""Thumbnails: resizing, cache, pruning, safe downloads and the /api/img route."""

import io
import os
import socket
import time
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.api import thumbs as thumbs_api
from rack.embeddings.images import ImageError, fetch_listing_image
from rack.ingest import upsert_listings
from rack.models import ListingImageRow
from rack.sources.base import Listing
from rack.thumbs import SETTINGS_VERSION, cache_path, make_thumb, pick_format, prune
from tests.conftest import login
from tests.fakes import png

H = {"X-Requested-With": "rack"}


def jpeg(size: tuple[int, int], orientation: int | None = None) -> bytes:
    img = Image.new("RGB", size, "red")
    buf = io.BytesIO()
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    img.save(buf, format="JPEG", exif=exif.tobytes())
    return buf.getvalue()


# --- pure ---


def test_make_thumb_is_small_webp_and_never_upscales() -> None:
    big = make_thumb(jpeg((1600, 2000)), 480)
    assert big[:4] == b"RIFF" and big[8:12] == b"WEBP"
    assert Image.open(io.BytesIO(big)).size == (480, 600)
    small = make_thumb(jpeg((300, 400)), 960)
    assert Image.open(io.BytesIO(small)).size == (300, 400)
    rotated = make_thumb(jpeg((800, 400), orientation=6), 480)  # EXIF "rotate 90"
    assert Image.open(io.BytesIO(rotated)).size == (400, 800)


def test_cache_path_is_per_source_and_width(tmp_path: Path) -> None:
    a = cache_path(tmp_path, "https://i.ebayimg.com/a.jpg", 480)
    assert a == cache_path(tmp_path, "https://i.ebayimg.com/a.jpg", 480)
    assert a != cache_path(tmp_path, "https://i.ebayimg.com/a.jpg", 960)
    assert a.suffix == ".webp" and a.parent.parent == tmp_path
    avif = cache_path(tmp_path, "https://i.ebayimg.com/a.jpg", 480, "avif")
    assert avif.suffix == ".avif" and avif != a
    assert f"_v{SETTINGS_VERSION}." in a.name  # a settings change never serves an old file


def test_avif_thumbs_and_format_choice() -> None:
    avif = make_thumb(jpeg((1600, 2000)), 640, "avif")
    img = Image.open(io.BytesIO(avif))
    assert img.format == "AVIF" and img.size == (640, 800)
    assert pick_format("image/avif,image/webp,image/apng,*/*") == "avif"
    assert pick_format("image/webp,*/*") == "webp"
    assert pick_format(None) == "webp"


def test_prune_also_removes_avif(tmp_path: Path) -> None:
    p = tmp_path / "ab" / "x.avif"
    p.parent.mkdir()
    p.write_bytes(b"x")
    assert prune(tmp_path, max_bytes=10**9, max_age_s=-1) == 1


def test_prune_by_age_then_size(tmp_path: Path) -> None:
    now = time.time()
    files = []
    for i, age_days in enumerate([10, 3, 2, 1]):
        p = tmp_path / "ab" / f"{i}.webp"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x" * 1000)
        os.utime(p, (now - age_days * 86400, now - age_days * 86400))
        files.append(p)
    removed = prune(tmp_path, max_bytes=2000, max_age_s=7 * 86400, now=now)
    assert removed == 2  # the 10-day-old one, then the oldest remaining to get under 2000 bytes
    assert [p.exists() for p in files] == [False, False, True, True]
    assert prune(tmp_path / "missing", max_bytes=1, max_age_s=1) == 0


async def test_downloads_only_from_marketplace_cdns_on_public_ips(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with httpx.AsyncClient() as client:
        with pytest.raises(ImageError):
            await fetch_listing_image("https://evil.example/a.jpg", client)
        with pytest.raises(ImageError):
            await fetch_listing_image("http://i.ebayimg.com/a.jpg", client)  # not https

        def private(*args: object, **kwargs: object) -> list[tuple[object, ...]]:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]

        monkeypatch.setattr(socket, "getaddrinfo", private)
        with pytest.raises(ImageError):
            await fetch_listing_image("https://i.ebayimg.com/a.jpg", client)  # DNS rebinding


# --- route ---


@pytest.mark.db
async def test_thumbnail_route(
    client: httpx.AsyncClient,
    sessions: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    assert (await client.get("/api/img/1")).status_code == 401  # login required
    await login(client)
    async with sessions() as s:
        await upsert_listings(
            s,
            [
                Listing(
                    source="vinted",
                    source_id="1",
                    url="https://www.vinted.co.uk/items/1-x",
                    title="Rick Owens jacket",
                    price=Decimal("100"),
                    currency="GBP",
                    images=["https://images1.vinted.net/t/1/f800/a.jpeg"],
                )
            ],
        )
        await s.commit()
        image_id = (await s.execute(select(ListingImageRow.id))).scalar_one()

    calls: list[str] = []

    async def fake_download(url: str) -> bytes:
        calls.append(url)
        return jpeg((1200, 1500))

    monkeypatch.setattr(thumbs_api, "download", fake_download)
    r = await client.get(f"/api/img/{image_id}?w=480")
    assert r.status_code == 200 and r.headers["content-type"] == "image/webp"
    assert "immutable" in r.headers["cache-control"] and "private" in r.headers["cache-control"]
    assert Image.open(io.BytesIO(r.content)).size == (480, 600)
    assert (await client.get(f"/api/img/{image_id}?w=480")).status_code == 200
    assert calls == ["https://images1.vinted.net/t/1/f800/a.jpeg"]  # second time from the cache
    assert (await client.get(f"/api/img/{image_id}?w=960")).status_code == 200
    assert len(calls) == 2
    assert (tmp_path / "data" / "thumbs").is_dir()
    assert r.headers["vary"] == "Accept"

    # Safari / Chrome send image/avif in Accept: they get AVIF, cached separately from WebP
    avif = await client.get(f"/api/img/{image_id}?w=480", headers={"Accept": "image/avif,image/webp,*/*"})
    assert avif.status_code == 200 and avif.headers["content-type"] == "image/avif"
    assert Image.open(io.BytesIO(avif.content)).format == "AVIF"
    assert len(calls) == 3
    await client.get(f"/api/img/{image_id}?w=480", headers={"Accept": "image/avif"})
    assert len(calls) == 3  # from the AVIF cache

    assert (await client.get(f"/api/img/{image_id}?w=123")).status_code == 422  # sizes fixed
    assert (await client.get("/api/img/999999")).status_code == 404  # only known photos

    async def broken(url: str) -> bytes:
        raise ImageError("image fetch HTTP 404")

    monkeypatch.setattr(thumbs_api, "download", broken)
    async with sessions() as s:
        row = await s.get(ListingImageRow, image_id)
        assert row is not None
        row.url = "https://images1.vinted.net/t/1/f800/gone.jpeg"
        await s.commit()
    assert (await client.get(f"/api/img/{image_id}")).status_code == 502


@pytest.mark.db
async def test_wardrobe_photo_thumbnail(client: httpx.AsyncClient) -> None:
    await login(client)
    r = await client.post(
        "/api/taste/upload",
        data={"kind": "wardrobe", "name": "coat"},
        files=[("files", ("a.png", png("black", (1500, 1500)), "image/png"))],
        headers=H,
    )
    item = r.json()[0]
    assert item["thumb"] == f"/api/taste/{item['id']}/thumb" and item["name"] == "coat"
    t = await client.get(f"{item['thumb']}?w=480")
    assert t.status_code == 200 and Image.open(io.BytesIO(t.content)).size == (480, 480)
