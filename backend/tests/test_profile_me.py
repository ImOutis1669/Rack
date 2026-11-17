"""v2.1 step 4: your profile, profile photo and "delete my account"."""

import io
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.avatars import SIDE, make_avatar
from rack.embeddings.images import ImageError
from rack.models import HuntRow, TasteItemRow, UserRow
from rack.sources.ebay import quota_day
from rack.store import set_user_state
from tests.conftest import OWNER, PASSWORD, creds, login, make_user

H = {"X-Requested-With": "rack"}
SAM_PW = "sam-password-long"


def photo(w: int = 800, h: int = 600, *, gps: bool = False) -> bytes:
    img = Image.new("RGB", (w, h), "red")
    out = io.BytesIO()
    exif = Image.Exif()
    if gps:
        exif[0x8825] = {2: (51.0, 30.0, 0.0)}  # GPSInfo: latitude
        exif[0x010F] = "PhoneMaker"
    img.save(out, format="JPEG", exif=exif.tobytes())
    return out.getvalue()


@asynccontextmanager
async def browser(client: httpx.AsyncClient) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as c:
        yield c


def test_avatar_is_square_and_metadata_free() -> None:
    out = Image.open(io.BytesIO(make_avatar(photo(1200, 700, gps=True))))
    assert out.size == (SIDE, SIDE) and out.format == "JPEG"
    assert not out.getexif()  # no GPS, no camera
    with pytest.raises(ImageError):
        make_avatar(b"not an image")


@pytest.mark.db
async def test_profile_details_and_photo(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    await login(client)
    me = (await client.get("/api/me")).json()
    assert (me["username"], me["role"], me["avatar"]) == (OWNER, "owner", None)
    assert me["created_at"]

    r = await client.patch("/api/me", json={"display_name": "  The \n Owner "}, headers=H)
    assert r.json()["display_name"] == "The Owner"
    assert (await client.get("/api/auth/me")).json()["display_name"] == "The Owner"
    long = await client.patch("/api/me", json={"display_name": "x" * 61}, headers=H)
    assert long.status_code == 400

    up = await client.put(
        "/api/me/avatar", files={"file": ("me.jpg", photo(gps=True), "image/jpeg")}, headers=H
    )
    assert up.status_code == 200, up.text
    url = up.json()["avatar"]
    assert url == "/api/me/avatar?v=1"
    got = await client.get(url)
    assert got.headers["content-type"] == "image/jpeg"
    assert "immutable" in got.headers["cache-control"] and "private" in got.headers["cache-control"]
    assert Image.open(io.BytesIO(got.content)).size == (SIDE, SIDE)
    again = await client.put(
        "/api/me/avatar", files={"file": ("me.jpg", photo(), "image/jpeg")}, headers=H
    )
    assert again.json()["avatar"] == "/api/me/avatar?v=2"  # new photo, new URL

    bad = await client.put(
        "/api/me/avatar", files={"file": ("x.jpg", b"nope", "image/jpeg")}, headers=H
    )
    assert bad.status_code == 400
    no_csrf = await client.put("/api/me/avatar", files={"file": ("me.jpg", photo(), "image/jpeg")})
    assert no_csrf.status_code == 403
    huge = await client.put(
        "/api/me/avatar",
        content=b"x" * (11 * 1024 * 1024),
        headers={**H, "Content-Type": "multipart/form-data; boundary=x"},
    )
    assert huge.status_code == 413

    gone = await client.delete("/api/me/avatar", headers=H)
    assert gone.json()["avatar"] is None
    assert (await client.get("/api/me/avatar")).status_code == 404
    assert not (tmp_path / "data" / "avatars" / "1.jpg").exists()


@pytest.mark.db
async def test_photos_are_private_and_admin_sees_counts(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    owner_id = await make_user(sessions, OWNER, "owner")
    sam_id = await make_user(sessions, "sam", password=SAM_PW)
    await login(client)
    await client.put("/api/me/avatar", files={"file": ("me.jpg", photo(), "image/jpeg")}, headers=H)
    async with browser(client) as sam:
        await login(sam, "sam", SAM_PW)
        assert (await sam.get("/api/me/avatar")).status_code == 404  # only ever your own
        r = await sam.get(f"/api/admin/users/{owner_id}/avatar")
        assert r.status_code == 403
        await sam.put("/api/me/avatar", files={"file": ("s.jpg", photo(), "image/jpeg")}, headers=H)
    async with sessions() as s:
        s.add(HuntRow(user_id=sam_id, name="Geo", query="geobasket", interval_minutes=60))
        await set_user_state(s, sam_id, "ebay_usage", {"day": quota_day(), "search": 7})
        await s.commit()
    users = {u["username"]: u for u in (await client.get("/api/admin/users")).json()}
    assert (users["sam"]["hunts"], users["sam"]["ebay_searches_today"]) == (1, 7)
    assert users["sam"]["avatar"] == f"/api/admin/users/{sam_id}/avatar?v=1"
    assert (await client.get(users["sam"]["avatar"])).status_code == 200  # the owner may look


@pytest.mark.db
async def test_delete_my_account_removes_everything(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession], tmp_path: Path
) -> None:
    from tests.test_phase2_db import png

    await make_user(sessions, OWNER, "owner")
    sam_id = await make_user(sessions, "sam", password=SAM_PW)
    await login(client)
    assert (
        await client.request("DELETE", "/api/me", json={"password": PASSWORD}, headers=H)
    ).status_code == 400  # the owner can't

    async with browser(client) as sam:
        await login(sam, "sam", SAM_PW)
        item = (
            await sam.post(
                "/api/taste/upload",
                data={"kind": "wardrobe"},
                files=[("files", ("a.png", png("black"), "image/png"))],
                headers=H,
            )
        ).json()[0]
        assert (await sam.get(f"{item['thumb']}?w=480")).status_code == 200  # cache a thumbnail
        await sam.put("/api/me/avatar", files={"file": ("s.jpg", photo(), "image/jpeg")}, headers=H)
        data = tmp_path / "data"
        assert any((data / "thumbs").rglob("*.*"))

        wrong = await sam.request(
            "DELETE", "/api/me", json={"password": "nope-nope-nope"}, headers=H
        )
        assert wrong.status_code == 400
        no_csrf = await sam.request("DELETE", "/api/me", json={"password": SAM_PW})
        assert no_csrf.status_code == 403
        r = await sam.request("DELETE", "/api/me", json={"password": SAM_PW}, headers=H)
        assert r.status_code == 204
        assert (await sam.get("/api/me")).status_code == 401
        assert (await sam.post("/api/auth/login", json=creds(SAM_PW, "sam"))).status_code == 401

    assert not (data / "uploads" / str(sam_id)).exists()
    assert not (data / "avatars" / f"{sam_id}.jpg").exists()
    assert not [p for p in (data / "thumbs").rglob("*") if p.is_file()]
    async with sessions() as s:
        assert await s.get(UserRow, sam_id) is None
        n = (
            await s.execute(
                select(func.count()).select_from(TasteItemRow).where(TasteItemRow.user_id == sam_id)
            )
        ).scalar_one()
        assert n == 0
    assert (await client.get("/api/me")).status_code == 200  # the owner is untouched
