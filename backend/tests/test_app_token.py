"""Bearer tokens for the iOS app (docs/ios-brief.md step 1).

They must keep every guarantee the audit (docs/security-audit-2026-11-16.md) gave the cookie:
shared login rate limits, "log out everywhere", password-change invalidation, expiry, and no
way to swap a cookie for a token or back. CSRF doesn't apply: browsers never send the header.
"""

import time

import httpx
import pytest
from itsdangerous import TimestampSigner, URLSafeTimedSerializer

from rack.api import auth
from tests.conftest import creds, login

H = {"X-Requested-With": "rack"}
SECRET = "test-secret-that-is-long-enough-1234567890"  # conftest's RACK_SESSION_SECRET


async def get_token(client: httpx.AsyncClient) -> str:
    r = await client.post("/api/auth/token", json=creds())
    assert r.status_code == 200, r.text
    return str(r.json()["token"])


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.db
async def test_token_login_works_without_cookie_or_csrf(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/auth/token", json=creds())
    assert r.status_code == 200
    assert r.headers["Cache-Control"] == "no-store"
    assert r.json()["expires_in"] == 30 * 86400
    assert "set-cookie" not in r.headers  # the app gets a token, not a cookie
    assert not client.cookies
    token = r.json()["token"]
    assert (await client.get("/api/auth/me", headers=bearer(token))).status_code == 200
    # writes need no X-Requested-With with a bearer token...
    assert (await client.post("/api/_test/mutate", headers=bearer(token))).status_code == 200
    # ...but a cookie still does (unchanged web behaviour)
    await login(client)
    assert (await client.post("/api/_test/mutate")).status_code == 403
    assert (await client.post("/api/_test/mutate", headers=H)).status_code == 200


@pytest.mark.db
async def test_token_login_shares_the_rate_limits(client: httpx.AsyncClient) -> None:
    for _ in range(auth.MAX_ATTEMPTS):
        r = await client.post("/api/auth/token", json=creds("wrong"))
        assert r.status_code == 401
        assert "token" not in r.text
    # the same counter guards both doors, so switching endpoint doesn't buy more tries
    assert (await client.post("/api/auth/login", json=creds(), headers={"X-Requested-With": "rack"})).status_code == 429
    assert (await client.post("/api/auth/token", json=creds())).status_code == 429


@pytest.mark.db
async def test_cookie_and_token_are_not_interchangeable(client: httpx.AsyncClient) -> None:
    token = await get_token(client)
    await login(client)
    cookie = client.cookies.get(auth.COOKIE)
    assert cookie
    client.cookies.clear()
    assert (await client.get("/api/auth/me", headers=bearer(cookie))).status_code == 401
    client.cookies.set(auth.COOKIE, token)
    assert (await client.get("/api/auth/me")).status_code == 401


@pytest.mark.db
@pytest.mark.parametrize("header", ["Basic abc", "Bearer", "Bearer ", "Bearer not-a-token", "x"])
async def test_bad_authorization_header_never_falls_back_to_cookie(
    client: httpx.AsyncClient, header: str
) -> None:
    await login(client)  # a valid cookie is present...
    r = await client.get("/api/auth/me", headers={"Authorization": header})
    assert r.status_code == 401  # ...but a present Authorization header is the only credential


@pytest.mark.db
async def test_logout_all_revokes_tokens(client: httpx.AsyncClient) -> None:
    token = await get_token(client)
    other = await get_token(client)  # e.g. a copy, or a second phone
    assert (await client.post("/api/auth/logout-all", headers=bearer(token))).status_code == 204
    assert (await client.get("/api/auth/me", headers=bearer(token))).status_code == 401
    assert (await client.get("/api/auth/me", headers=bearer(other))).status_code == 401
    fresh = await get_token(client)  # logging in again works
    assert (await client.get("/api/auth/me", headers=bearer(fresh))).status_code == 200


@pytest.mark.db
async def test_logout_all_from_the_web_revokes_tokens(client: httpx.AsyncClient) -> None:
    token = await get_token(client)
    await login(client)
    assert (await client.post("/api/auth/logout-all", headers=H)).status_code == 204
    client.cookies.clear()
    assert (await client.get("/api/auth/me", headers=bearer(token))).status_code == 401


@pytest.mark.db
async def test_password_change_revokes_tokens(client: httpx.AsyncClient) -> None:
    token = await get_token(client)
    phone = await get_token(client)
    r = await client.post(
        "/api/auth/password",
        json={"current_password": "a-very-long-test-password", "new_password": "a-new-long-pw!!"},
        headers=bearer(phone),
    )
    assert r.status_code == 200, r.text
    fresh = r.json()["token"]  # the phone that changed it gets a new token...
    assert "set-cookie" not in r.headers
    assert (await client.get("/api/auth/me", headers=bearer(fresh))).status_code == 200
    for old in (token, phone):  # ...and every older one stops working
        assert (await client.get("/api/auth/me", headers=bearer(old))).status_code == 401


@pytest.mark.db
async def test_expired_token_is_refused(client: httpx.AsyncClient) -> None:
    from rack.config import get_settings

    settings = client._transport.app.dependency_overrides[get_settings]()  # type: ignore[attr-defined]
    me = (await client.get("/api/auth/me", headers=bearer(await get_token(client)))).json()
    claims = {"u": me["id"], "e": 0, "p": auth.password_fingerprint(settings.rack_password_hash)}

    class Old(TimestampSigner):
        def get_timestamp(self) -> int:
            return int(time.time()) - (settings.rack_session_days * 86400 + 60)

    old = URLSafeTimedSerializer(SECRET, salt=auth.APP_TOKEN_SALT, signer=Old).dumps(claims)
    fresh = URLSafeTimedSerializer(SECRET, salt=auth.APP_TOKEN_SALT).dumps(claims)
    assert (await client.get("/api/auth/me", headers=bearer(old))).status_code == 401
    assert (await client.get("/api/auth/me", headers=bearer(fresh))).status_code == 200
