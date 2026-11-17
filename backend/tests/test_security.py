"""Regression tests for docs/security-audit-2026-11-16.md (RACK-01 .. RACK-10)."""

import time
from decimal import Decimal

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.api import auth
from rack.api.main import config_problems
from rack.config import Settings
from rack.embeddings import images
from rack.embeddings.images import ImageError, is_listing_image_host, pinned_request
from rack.sources.base import build_listing
from rack.sources.ebay import parse_item
from tests.conftest import PASSWORD, creds, login, password_hash

H = {"X-Requested-With": "rack"}


# --- RACK-01: login rate limit can't be dodged ---


@pytest.mark.db
async def test_spoofed_cf_header_from_untrusted_peer_is_ignored(client: httpx.AsyncClient) -> None:
    codes = [
        (
            await client.post(
                "/api/auth/login",
                json=creds("x"),
                headers={"X-Requested-With": "rack", "CF-Connecting-IP": f"10.0.0.{i}"},
            )
        ).status_code
        for i in range(6)
    ]
    assert codes == [401] * 5 + [429]


@pytest.mark.db
async def test_trusted_tunnel_header_is_used_and_global_cap_holds(
    client: httpx.AsyncClient,
) -> None:
    auth._trusted = (time.monotonic(), frozenset({"127.0.0.1"}))  # pretend the peer is cloudflared
    for i in range(auth.GLOBAL_MAX_ATTEMPTS):
        r = await client.post(
            "/api/auth/login",
            json=creds("x", f"nobody{i}"),  # spread over usernames, so only IP + global count
            headers={"X-Requested-With": "rack", "CF-Connecting-IP": f"203.0.113.{i}"},
        )
        assert r.status_code == 401  # each real client IP gets its own 5 tries...
    r = await client.post(
        "/api/auth/login",
        json=creds(),
        headers={"X-Requested-With": "rack", "CF-Connecting-IP": "198.51.100.7"},
    )
    assert r.status_code == 429  # ...but 60 failures in total closes login for everyone


def test_attempt_store_is_bounded() -> None:
    a = auth.LoginAttempts()
    for i in range(auth.MAX_TRACKED_IPS + 10):
        a.fail(f"ip{i}", now=1.0)
    assert len(a._hits) <= auth.MAX_TRACKED_IPS


# --- RACK-02: sessions can be revoked ---


@pytest.mark.db
async def test_logout_all_kills_copied_cookies(client: httpx.AsyncClient) -> None:
    await login(client)
    copied = client.cookies.get(auth.COOKIE)
    assert (await client.post("/api/auth/logout-all", headers=H)).status_code == 204
    client.cookies.set(auth.COOKIE, copied)
    assert (await client.get("/api/auth/me")).status_code == 401
    client.cookies.clear()
    await login(client)  # logging in again works
    assert (await client.get("/api/auth/me")).status_code == 200


@pytest.mark.db
async def test_password_change_ends_other_sessions(client: httpx.AsyncClient) -> None:
    await login(client)
    copied = client.cookies.get(auth.COOKIE)
    r = await client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": "a-new-long-password!"},
        headers=H,
    )
    assert r.status_code == 200, r.text
    assert (await client.get("/api/auth/me")).status_code == 200  # this browser got a new cookie
    client.cookies.clear()
    client.cookies.set(auth.COOKIE, copied)
    assert (await client.get("/api/auth/me")).status_code == 401  # every other one is out
    client.cookies.clear()
    assert (
        await client.post("/api/auth/login", json=creds(), headers={"X-Requested-With": "rack"})
    ).status_code == 401
    await login(client, password="a-new-long-password!")


# --- RACK-03 / RACK-09: image fetches ---


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("https://images1.vinted.net/t/x.webp", True),
        ("https://media-assets.grailed.com/prd/x", True),
        ("https://i.ebayimg.com/images/g/x.jpg", True),
        ("http://i.ebayimg.com/images/g/x.jpg", False),  # not https
        ("https://192.168.1.1/apply.cgi", False),
        ("https://api:8000/api/feed", False),
        ("https://evil.example/vinted.net.jpg", False),
        ("https://vinted.net.evil.example/x.jpg", False),
    ],
)
def test_listing_image_host_allowlist(url: str, ok: bool) -> None:
    assert is_listing_image_host(url) is ok


async def test_worker_refuses_internal_image_urls() -> None:
    from rack.worker.main import EmbedAndScore

    job = EmbedAndScore()
    for url in ("http://192.168.1.1/x.jpg", "https://api:8000/", "file:///etc/passwd"):
        with pytest.raises(ImageError):
            await job.fetch(url)


def test_pinned_request_keeps_host_and_sni() -> None:
    url, headers, ext = pinned_request("https://img.example.com/a/b.jpg?x=1", "93.184.216.34")
    assert url == "https://93.184.216.34/a/b.jpg?x=1"
    assert headers == {"Host": "img.example.com"} and ext == {"sni_hostname": "img.example.com"}
    v6, _, _ = pinned_request("https://img.example.com:8443/a", "2606:2800::1")
    assert v6 == "https://[2606:2800::1]:8443/a"


async def test_user_url_fetch_connects_to_the_checked_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_resolve(url: str) -> str:
        return "93.184.216.34"

    monkeypatch.setattr(images, "resolve_public", fake_resolve)
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        import io

        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (8, 8)).save(buf, format="PNG")
        return httpx.Response(200, content=buf.getvalue(), headers={"content-type": "image/png"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        await images.fetch_user_image("https://img.example.com/x.png", c)
    assert seen[0].url.host == "93.184.216.34"
    assert seen[0].headers["host"] == "img.example.com"
    assert seen[0].extensions["sni_hostname"] == "img.example.com"


async def test_private_addresses_still_refused() -> None:
    with pytest.raises(ImageError):
        await images.resolve_public("http://localhost/x.jpg")


# --- RACK-04 / RACK-08: headers and body limits ---


@pytest.mark.db
async def test_security_headers_present(client: httpx.AsyncClient) -> None:
    r = await client.get("/api/health")
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert r.headers["x-frame-options"] == "DENY"


@pytest.mark.db
async def test_oversized_requests_rejected(client: httpx.AsyncClient) -> None:
    await login(client)
    big = {"Content-Length": str(2 * 1024 * 1024), **H}
    r = await client.post(
        "/api/hidden", content=b"{}", headers={**big, "content-type": "application/json"}
    )
    assert r.status_code == 413
    huge = {"Content-Length": str(500 * 1024 * 1024), **H}
    assert (await client.post("/api/taste/upload", content=b"", headers=huge)).status_code == 413


# --- RACK-05: only http(s) listing URLs ---


def test_listing_urls_must_be_http() -> None:
    base = dict(source="x", source_id="1", title="t", price=Decimal(1), currency="GBP")
    assert build_listing(url="javascript:alert(1)", **base) is None
    assert build_listing(url="data:text/html,x", **base) is None
    ok = build_listing(
        url="https://www.ebay.co.uk/itm/1", images=["javascript:x", "https://i/1.jpg"], **base
    )
    assert ok is not None and ok.images == ["https://i/1.jpg"]
    item = {
        "itemId": "v1|1|0",
        "title": "t",
        "price": {"value": "1", "currency": "GBP"},
        "itemWebUrl": "javascript:alert(1)",
    }
    assert parse_item(item) is None


# --- RACK-10: weak configuration ---


def test_config_problems_and_short_secret() -> None:
    s = Settings(
        rack_session_secret="short",
        rack_password_hash="plain",
        rack_public_url="https://x",
        rack_cookie_secure=False,
    )
    problems = " ".join(config_problems(s))
    assert (
        "RACK_SESSION_SECRET" in problems
        and "argon2" in problems
        and "RACK_COOKIE_SECURE" in problems
    )
    good = Settings(
        rack_session_secret="x" * 40,
        rack_password_hash=password_hash(),
        rack_public_url="https://x",
        rack_cookie_secure=True,
    )
    assert config_problems(good) == []
    with pytest.raises(Exception, match="at least 32"):
        auth._serializer(s)


# --- audit 2026-11-17 (v2.1) ---


@pytest.mark.db
async def test_login_needs_the_csrf_header(client: httpx.AsyncClient) -> None:
    """RACK-22: a cross-site form can't log a browser into someone else's account."""
    assert (await client.post("/api/auth/login", json=creds())).status_code == 403
    assert not client.cookies
    # the iOS app's token login has no cookie, so it needs no header
    assert (await client.post("/api/auth/token", json=creds())).status_code == 200


@pytest.mark.db
async def test_private_photos_are_revalidated_every_time(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    """RACK-21: your photos may be cached, but never shown from cache without asking the
    server, so another account on the same browser can't see them."""
    from tests.conftest import OWNER, make_user
    from tests.test_phase2_db import png

    await make_user(sessions, OWNER, "owner")
    await make_user(sessions, "sam", password="sam-password-long")
    await login(client)
    item = (
        await client.post(
            "/api/taste/upload",
            data={"kind": "wardrobe"},
            files=[("files", ("a.png", png("black"), "image/png"))],
            headers=H,
        )
    ).json()[0]
    av = await client.put(
        "/api/me/avatar", files={"file": ("a.png", png("red"), "image/png")}, headers=H
    )
    urls = [item["image"], item["thumb"] + "?w=480", av.json()["avatar"]]
    for url in urls:
        r = await client.get(url)
        assert r.status_code == 200, url
        assert r.headers["cache-control"] == "private, no-cache", url
        etag = r.headers["etag"]
        again = await client.get(url, headers={"If-None-Match": etag})
        assert again.status_code == 304 and not again.content
    # another account asking the same URLs (as a browser revalidating would): never the photo
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as sam:
        await login(sam, "sam", "sam-password-long")
        for url in urls[:2]:
            assert (await sam.get(url, headers={"If-None-Match": etag})).status_code == 404
        assert (await sam.get(urls[2])).status_code == 404  # sam has no photo of their own
    # shared listing thumbnails keep their long cache
    from rack.api.thumbs import CACHE_HEADERS

    assert "immutable" in CACHE_HEADERS["Cache-Control"]
