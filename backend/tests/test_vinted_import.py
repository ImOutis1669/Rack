"""Importing Vinted likes from Vinted's personal-data export. Made-up exports only (the repo is
public): the real one also holds messages, invoices and addresses, which are never read."""

import io
import zipfile
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.ingest import upsert_listings
from rack.models import FeedbackRow, ListingImageRow, ListingRow
from rack.sources.base import Listing, SourceError
from rack.sources.vinted import ItemDetails, VintedAdapter
from rack.store import get_user_state
from rack.vinted_export import ExportError, parse_favourites, read_export
from rack.worker.vinted_import import favourite_listing, run_vinted_imports
from tests.conftest import OWNER, login, make_user
from tests.fakes import FakeEmbedder, png

H = {"X-Requested-With": "rack"}


def page(*items: tuple[str, str]) -> str:
    cells = "".join(
        f'<div class="cell-description" itemscope> <span itemprop="username"> seller{i}: </span>'
        f' <a itemprop="link_to_item" href="https://www.vinted.co.uk/items/{item_id}">'
        f' {title} </a>: <span itemprop="created_at"> 2026-0{i % 9 + 1}-01 10:00:00 +0100 </span></div>'
        for i, (item_id, title) in enumerate(items)
    )
    return f'<html><body><div class="cell-header"> Favourite items </div>{cells}</body></html>'


def export_zip(html: str, with_favourites: bool = True) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("index.html", "<a href='favourite_items/index.html'>Favourite items</a>")
        z.writestr("messages/index.html", "<p>private conversation</p>")
        z.writestr("favourites/index.html", "<p>members you follow</p>")
        if with_favourites:
            z.writestr("favourite_items/index.html", html)
    return buf.getvalue()


# --- reading the export ---


def test_reads_liked_items_once_each() -> None:
    favs = parse_favourites(
        page(("111", "Rick Owens Geobasket"), ("222", "Margiela &quot;Tabi&quot;"), ("111", "dup"))
    )
    assert [(f.item_id, f.title) for f in favs] == [
        ("111", "Rick Owens Geobasket"),
        ("222", 'Margiela "Tabi"'),
    ]
    assert favs[0].liked_at == "2026-01-01 10:00:00 +0100"


def test_reads_only_the_favourites_page_of_a_zip() -> None:
    data = export_zip(page(("333", "Kapital boro jacket")))
    favs = read_export(io.BytesIO(data), "eddie-20261119.zip")
    assert [f.item_id for f in favs] == ["333"]
    html = page(("444", "Lemaire twisted shirt")).encode()
    assert [f.item_id for f in read_export(io.BytesIO(html), "index.html")] == ["444"]


@pytest.mark.parametrize(
    ("data", "name", "message"),
    [
        (export_zip("", with_favourites=False), "export.zip", "no favourite items page"),
        (export_zip("<p>nothing liked</p>"), "export.zip", "No liked items"),
        (b"PK\x03\x04 not really a zip", "export.zip", "damaged"),
        (b"%PDF-1.7", "invoice.pdf", "Upload the Vinted export"),
    ],
)
def test_rejects_what_isnt_an_export(data: bytes, name: str, message: str) -> None:
    with pytest.raises(ExportError, match=message):
        read_export(io.BytesIO(data), name)


def test_listing_from_an_item_page_adds_buyer_protection() -> None:
    d = ItemDetails(
        images=["https://images1.vinted.net/t/a/f800/1.jpeg"],
        description="worn twice",
        price=Decimal("100"),
        currency="GBP",
        available=False,
        title="Kapital boro jacket",
        brand="Kapital",
    )
    listing = favourite_listing("333", "export title", d)
    assert listing is not None
    assert (listing.title, listing.brand, listing.price_gbp) == (
        "Kapital boro jacket",
        "Kapital",
        Decimal("105.70"),  # £0.70 + 5%, which every Vinted buyer pays
    )
    assert listing.url == "https://www.vinted.co.uk/items/333"
    assert favourite_listing("333", "x", ItemDetails([], None, None, None, None)) is None


# --- the import ---


class FakeVinted(VintedAdapter):
    def __init__(self, pages: dict[str, ItemDetails | Exception]) -> None:
        super().__init__(min_interval=0)
        self.pages = pages
        self.asked: list[str] = []

    async def item_details(self, url: str) -> ItemDetails:
        item_id = url.rsplit("/", 1)[1]
        self.asked.append(item_id)
        result = self.pages[item_id]
        if isinstance(result, Exception):
            raise result
        return result


def _vinted(sid: str) -> Listing:
    return Listing(
        source="vinted",
        source_id=sid,
        url=f"https://www.vinted.co.uk/items/{sid}",
        title=f"listing {sid}",
        price=Decimal("50"),
        currency="GBP",
        price_gbp=Decimal("53.20"),
        images=[f"https://images1.vinted.net/t/{sid}/f800/a.jpeg"],
    )


@pytest.mark.db
async def test_import_likes_known_items_and_queues_the_rest(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    owner_id = await make_user(sessions, OWNER, "owner")
    async with sessions() as s:
        known, downvoted = await upsert_listings(s, [_vinted("111"), _vinted("222")])
        s.add(FeedbackRow(user_id=owner_id, listing_id=downvoted, value=-1))
        await s.commit()
    await login(client)
    data = export_zip(page(("111", "a"), ("222", "b"), ("333", "c"), ("444", "d")))
    files = {"file": ("export.zip", data, "application/zip")}

    r = (await client.post("/api/import/vinted", files=files, headers=H)).json()
    assert (r["total"], r["already"], r["skipped"], r["queued"], r["running"]) == (4, 1, 1, 2, True)
    async with sessions() as s:
        votes = dict((await s.execute(select(FeedbackRow.listing_id, FeedbackRow.value))).all())
    assert votes == {known: 1, downvoted: -1}  # your 👎 in Rack wins over the old Vinted like
    again = await client.post("/api/import/vinted", files=files, headers=H)
    assert again.status_code == 409  # one import at a time
    bad = await client.post(
        "/api/import/vinted", files={"file": ("x.pdf", b"%PDF", "application/pdf")}, headers=H
    )
    assert bad.status_code in (400, 409)


@pytest.mark.db
async def test_worker_adds_and_likes_each_item_at_vinteds_pace(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    from rack.worker.taste import embed_listings

    owner_id = await make_user(sessions, OWNER, "owner")
    await login(client)
    data = export_zip(page(("333", "Kapital boro"), ("444", "gone"), ("555", "blocked")))
    await client.post(
        "/api/import/vinted", files={"file": ("e.zip", data, "application/zip")}, headers=H
    )
    sold = ItemDetails(
        images=["https://images1.vinted.net/t/333/f800/a.jpeg"],
        description=None,
        price=Decimal("100"),
        currency="GBP",
        available=False,
        title="Kapital boro jacket",
        brand="Kapital",
    )
    vinted = FakeVinted(
        {
            "333": sold,
            "444": SourceError("Vinted item no longer exists (404)"),
            "555": SourceError("Vinted refused the request (HTTP 403); not retrying"),
        }
    )
    now = datetime.now(UTC)
    for _ in range(3):
        assert await run_vinted_imports(sessions, {"vinted": vinted}, now)
    assert vinted.asked == ["333", "444", "555"]  # one item per run
    async with sessions() as s:
        state = await get_user_state(s, owner_id, "vinted_import")
        row = (
            await s.execute(select(ListingRow).where(ListingRow.source_id == "333"))
        ).scalar_one()
        liked = (
            await s.execute(select(FeedbackRow.value).where(FeedbackRow.listing_id == row.id))
        ).scalar_one()
    assert (state["added"], state["missing"], len(state["queue"])) == (1, 1, 1)
    assert state["paused_until"] and "turning requests away" in state["error"]
    assert (row.active, row.brand, liked) == (False, "Kapital", 1)  # sold: kept, hidden, liked

    # paused: nothing is asked until the pause is over, then the same item again
    assert not await run_vinted_imports(sessions, {"vinted": vinted}, now + timedelta(minutes=5))
    vinted.pages["555"] = sold.__class__(**{**sold.__dict__, "available": True, "title": "ok"})
    assert await run_vinted_imports(sessions, {"vinted": vinted}, now + timedelta(minutes=31))
    status = (await client.get("/api/import/vinted")).json()
    assert (status["running"], status["added"], status["error"]) == (False, 2, None)
    assert status["finished_at"] is not None

    # the sold one you liked still gets its photo embedded, so it shapes your taste
    async def fetch(url: str) -> bytes:
        return png("black")

    await embed_listings(sessions, FakeEmbedder(), fetch)
    async with sessions() as s:
        emb = (
            await s.execute(
                select(ListingImageRow.embedding).where(ListingImageRow.listing_id == row.id)
            )
        ).scalar_one()
    assert emb is not None


def test_item_page_gives_title_and_brand() -> None:
    from pathlib import Path

    from rack.sources.vinted import parse_item_page

    html = (Path(__file__).parent / "fixtures" / "vinted" / "item_10761447613.html").read_text(
        encoding="utf-8"
    )
    d = parse_item_page(html, "10761447613")
    assert (d.title, d.brand, d.price) == (
        "Fw 17 Rick Owens Geothrasher",
        "Rick Owens",
        Decimal(225),
    )
