"""v2.1: the owner's licensed font and icons are served to the owner only, never publicly."""

from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from tests.conftest import OWNER, login, make_user

SAM_PW = "sam-password-long"


@pytest.fixture
def private(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    from rack.config import get_settings

    root = tmp_path / "private"
    (root / "fonts").mkdir(parents=True)
    (root / "fonts" / "neuemontreal-regular.otf").write_bytes(b"OTTO font")
    (root / "basil.json").write_text(
        '{"bookmark": {"outline": "<path d=\\"M0 0\\"/>", "solid": ""}}'
    )
    (tmp_path / "secret.txt").write_text("nope")
    s = get_settings()
    monkeypatch.setattr(s, "rack_private_dir", root)
    return root


@pytest.mark.db
async def test_owner_gets_font_and_icons_friends_and_strangers_dont(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession], private: Path
) -> None:
    await make_user(sessions, OWNER, "owner")
    await make_user(sessions, "sam", password=SAM_PW)
    font = "/api/owner-assets/fonts/neuemontreal-regular.otf"
    assert (await client.get(font)).status_code == 401
    assert (await client.get("/api/owner-assets/icons.json")).status_code == 401

    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as sam:
        await login(sam, "sam", SAM_PW)
        assert (await sam.get(font)).status_code == 403
        assert (await sam.get("/api/owner-assets/icons.json")).status_code == 403

    await login(client)
    r = await client.get(font)
    assert r.status_code == 200 and r.content == b"OTTO font"
    assert r.headers["content-type"] == "font/otf"
    assert r.headers["cache-control"].startswith("private")
    icons = (await client.get("/api/owner-assets/icons.json")).json()
    assert "bookmark" in icons
    for bad in ("../secret.txt", "..%2Fsecret.txt", "neuemontreal-light.otf", "basil.json"):
        assert (await client.get(f"/api/owner-assets/fonts/{bad}")).status_code == 404
    # the public SPA route doesn't serve them either
    assert (await client.get("/fonts/neuemontreal-regular.otf")).headers.get(
        "content-type", ""
    ).startswith("text/html") or (
        await client.get("/fonts/neuemontreal-regular.otf")
    ).status_code == 404


@pytest.mark.db
async def test_missing_private_files_are_a_plain_404(
    client: httpx.AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from rack.config import get_settings

    monkeypatch.setattr(get_settings(), "rack_private_dir", tmp_path / "nothing")
    await login(client)
    assert (await client.get("/api/owner-assets/icons.json")).status_code == 404
