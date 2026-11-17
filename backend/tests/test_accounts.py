"""v2.1 step 1: accounts, username login, per-user sessions, invites and owner admin."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from itsdangerous import URLSafeTimedSerializer
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack import accounts
from rack.accounts import AccountError
from rack.api import auth
from rack.models import InviteRow, UserRow
from tests.conftest import OWNER, PASSWORD, creds, login

H = {"X-Requested-With": "rack"}
SECRET = "test-secret-that-is-long-enough-1234567890"
FRIEND_PW = "friend-password-long-enough"


# --- pure rules ---


@pytest.mark.parametrize("name", ["ab", "a" * 25, "has space", "émile", "admin", "x/y", "..."])
def test_bad_usernames(name: str) -> None:
    with pytest.raises(AccountError):
        accounts.check_username(name)


def test_usernames_are_lowercased() -> None:
    assert accounts.check_username("  Sam.R_2 ") == "sam.r_2"


@pytest.mark.parametrize(
    "pw",
    ["short", "password1234", "aaaaaaaaaaaaaaaa", "ababababababab", "x" * 300, "sam-is-great-2026"],
)
def test_bad_passwords(pw: str) -> None:
    with pytest.raises(AccountError):
        accounts.check_password(pw, "sam")


def test_display_name_is_cleaned() -> None:
    assert accounts.check_display_name("  Sam \n  R\t", "sam") == "Sam R"
    assert accounts.check_display_name("", "sam") == "sam"
    with pytest.raises(AccountError):
        accounts.check_display_name("x" * 61, "sam")


def test_invite_codes_are_long_and_only_hashed() -> None:
    code = accounts.new_invite_code()
    assert len(code) >= 22  # 128 bits, url-safe
    assert accounts.invite_hash(code) != code and len(accounts.invite_hash(code)) == 64


# --- helpers ---


@asynccontextmanager
async def other_browser(client: httpx.AsyncClient) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=client._transport,  # same app, its own cookies
        base_url="http://test",
    ) as c:
        yield c


async def invite(client: httpx.AsyncClient, note: str = "Sam") -> dict[str, str]:
    r = await client.post("/api/admin/invites", json={"note": note}, headers=H)
    assert r.status_code == 201, r.text
    return dict(r.json())


async def make_friend(client: httpx.AsyncClient, friend: httpx.AsyncClient, name: str) -> None:
    """`client` is logged in as the owner; `friend` ends up logged in as `name`."""
    code = (await invite(client))["code"]
    r = await friend.post(
        "/api/auth/signup",
        json={"invite": code, "username": name, "password": FRIEND_PW, "display_name": "Sam"},
        headers=H,
    )
    assert r.status_code == 204, r.text


# --- owner bootstrap and login ---


@pytest.mark.db
async def test_owner_is_created_from_env_on_first_login(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    async with sessions() as s:
        assert (await s.execute(select(UserRow))).first() is None
    await login(client)
    me = (await client.get("/api/auth/me")).json()
    assert me["username"] == OWNER and me["role"] == "owner"
    await login(client)  # second login doesn't create a second owner
    async with sessions() as s:
        assert len((await s.execute(select(UserRow))).all()) == 1


@pytest.mark.db
async def test_unknown_user_and_wrong_password_look_the_same(client: httpx.AsyncClient) -> None:
    await login(client)
    a = await client.post(
        "/api/auth/login", json=creds("wrong-password!!"), headers={"X-Requested-With": "rack"}
    )
    b = await client.post(
        "/api/auth/login", json=creds(PASSWORD, "nobody"), headers={"X-Requested-With": "rack"}
    )
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json() == {"detail": auth.FAILED}


@pytest.mark.db
async def test_username_login_is_case_insensitive(client: httpx.AsyncClient) -> None:
    await login(client, username="  OWNER ")
    assert (await client.get("/api/auth/me")).status_code == 200


@pytest.mark.db
async def test_per_username_limit_holds_across_ips(client: httpx.AsyncClient) -> None:
    auth._trusted = (9e18, frozenset({"127.0.0.1"}))  # pretend the peer is the tunnel
    for i in range(auth.MAX_ATTEMPTS):
        r = await client.post(
            "/api/auth/login",
            json=creds("nope-nope-nope"),
            headers={"X-Requested-With": "rack", "CF-Connecting-IP": f"10.1.0.{i}"},
        )
        assert r.status_code == 401
    r = await client.post(
        "/api/auth/login",
        json=creds(),
        headers={"X-Requested-With": "rack", "CF-Connecting-IP": "10.2.0.1"},
    )
    assert r.status_code == 429  # guessing one account from many IPs doesn't work


@pytest.mark.db
async def test_cookie_from_before_accounts_is_refused(client: httpx.AsyncClient) -> None:
    from tests.conftest import password_hash

    await login(client)
    old = URLSafeTimedSerializer(SECRET, salt="rack-session").dumps(
        {"e": 0, "p": auth.password_fingerprint(password_hash())}
    )
    client.cookies.clear()
    client.cookies.set(auth.COOKIE, old)
    assert (await client.get("/api/auth/me")).status_code == 401


@pytest.mark.db
@pytest.mark.parametrize("uid", [True, "1", None, 1.0])
async def test_odd_user_ids_in_claims_are_refused(client: httpx.AsyncClient, uid: object) -> None:
    from tests.conftest import password_hash

    await login(client)
    forged = URLSafeTimedSerializer(SECRET, salt="rack-session").dumps(
        {"u": uid, "e": 0, "p": auth.password_fingerprint(password_hash())}
    )
    client.cookies.clear()
    client.cookies.set(auth.COOKIE, forged)
    assert (await client.get("/api/auth/me")).status_code == 401


# --- invites and sign-up ---


@pytest.mark.db
async def test_signup_with_invite_creates_a_friend(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await login(client)
    created = await invite(client)
    assert created["url"].endswith("/join#" + created["code"])
    async with sessions() as s:  # only the hash is stored
        row = (await s.execute(select(InviteRow))).scalar_one()
        assert row.code_hash == accounts.invite_hash(created["code"])
        assert created["code"] not in str(row.__dict__)
    async with other_browser(client) as friend:
        r = await friend.post(
            "/api/auth/signup",
            json={"invite": created["code"], "username": "Sam", "password": FRIEND_PW},
            headers=H,
        )
        assert r.status_code == 204, r.text
        me = (await friend.get("/api/auth/me")).json()
        assert me["username"] == "sam" and me["role"] == "friend"
        # the friend can log in with username + password
        friend.cookies.clear()
        await login(friend, "sam", FRIEND_PW)
        # and the invite is used up
        again = await friend.post(
            "/api/auth/signup",
            json={"invite": created["code"], "username": "sam2", "password": FRIEND_PW},
            headers=H,
        )
        assert again.status_code == 400
    listed = (await client.get("/api/admin/invites")).json()
    assert listed[0]["status"] == "used" and listed[0]["used_by"] == "sam"


@pytest.mark.db
async def test_bad_revoked_and_expired_invites_get_the_same_answer(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await login(client)
    revoked = await invite(client)
    assert (
        await client.delete(f"/api/admin/invites/{revoked['id']}", headers=H)
    ).status_code == 204
    expired = await invite(client)
    async with sessions() as s:
        await s.execute(
            update(InviteRow)
            .where(InviteRow.id == int(expired["id"]))
            .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )
        await s.commit()
    answers = []
    async with other_browser(client) as friend:
        for code in (revoked["code"], expired["code"], "made-up-code"):
            r = await friend.post(
                "/api/auth/signup",
                json={"invite": code, "username": "sam", "password": FRIEND_PW},
                headers=H,
            )
            answers.append((r.status_code, r.json()))
    assert len(set(map(str, answers))) == 1 and answers[0][0] == 400


@pytest.mark.db
async def test_guessing_invites_is_rate_limited(client: httpx.AsyncClient) -> None:
    await login(client)
    good = (await invite(client))["code"]
    async with other_browser(client) as friend:
        for i in range(auth.MAX_ATTEMPTS):
            r = await friend.post(
                "/api/auth/signup",
                json={"invite": f"guess-{i}", "username": "sam", "password": FRIEND_PW},
                headers=H,
            )
            assert r.status_code == 400
        r = await friend.post(
            "/api/auth/signup",
            json={"invite": good, "username": "sam", "password": FRIEND_PW},
            headers=H,
        )
        assert r.status_code == 429


@pytest.mark.db
async def test_signup_needs_csrf_header_and_rejects_taken_names(client: httpx.AsyncClient) -> None:
    await login(client)
    code = (await invite(client))["code"]
    async with other_browser(client) as friend:
        body = {"invite": code, "username": OWNER, "password": FRIEND_PW}
        assert (await friend.post("/api/auth/signup", json=body)).status_code == 403
        r = await friend.post("/api/auth/signup", json=body, headers=H)
        assert r.status_code == 409
        weak = {**body, "username": "sam", "password": "password1234"}
        assert (await friend.post("/api/auth/signup", json=weak, headers=H)).status_code == 400
        ok = {**body, "username": "sam"}
        assert (await friend.post("/api/auth/signup", json=ok, headers=H)).status_code == 204


# --- per-user sessions ---


@pytest.mark.db
async def test_logout_all_only_ends_your_own_sessions(client: httpx.AsyncClient) -> None:
    await login(client)
    async with other_browser(client) as friend:
        await make_friend(client, friend, "sam")
        assert (await friend.post("/api/auth/logout-all", headers=H)).status_code == 204
        assert (await client.get("/api/auth/me")).status_code == 200  # owner still in
        await login(friend, "sam", FRIEND_PW)
        assert (await client.post("/api/auth/logout-all", headers=H)).status_code == 204
        assert (await friend.get("/api/auth/me")).status_code == 200  # friend still in


@pytest.mark.db
async def test_password_change_needs_the_current_one(client: httpx.AsyncClient) -> None:
    await login(client)
    r = await client.post(
        "/api/auth/password",
        json={"current_password": "not-my-password", "new_password": "another-long-one!"},
        headers=H,
    )
    assert r.status_code == 400
    r = await client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": "short"},
        headers=H,
    )
    assert r.status_code == 400
    await login(client)  # unchanged


# --- admin ---


@pytest.mark.db
async def test_friends_cant_use_admin(client: httpx.AsyncClient) -> None:
    await login(client)
    async with other_browser(client) as friend:
        await make_friend(client, friend, "sam")
        assert (await friend.get("/api/admin/users")).status_code == 403
        assert (await friend.get("/api/admin/invites")).status_code == 403
        r = await friend.post("/api/admin/invites", json={}, headers=H)
        assert r.status_code == 403
    async with other_browser(client) as anon:
        assert (await anon.get("/api/admin/users")).status_code == 401


@pytest.mark.db
async def test_disable_and_delete_end_a_friends_sessions(client: httpx.AsyncClient) -> None:
    await login(client)
    async with other_browser(client) as friend:
        await make_friend(client, friend, "sam")
        users = (await client.get("/api/admin/users")).json()
        owner_id = next(u["id"] for u in users if u["role"] == "owner")
        sam = next(u["id"] for u in users if u["username"] == "sam")
        # the owner can't be disabled or deleted
        assert (
            await client.post(f"/api/admin/users/{owner_id}/disable", headers=H)
        ).status_code == 400
        assert (await client.delete(f"/api/admin/users/{owner_id}", headers=H)).status_code == 400

        assert (await client.post(f"/api/admin/users/{sam}/disable", headers=H)).status_code == 200
        assert (await friend.get("/api/auth/me")).status_code == 401
        r = await friend.post(
            "/api/auth/login", json=creds(FRIEND_PW, "sam"), headers={"X-Requested-With": "rack"}
        )
        assert r.status_code == 401 and r.json() == {"detail": auth.FAILED}
        assert (await client.post(f"/api/admin/users/{sam}/enable", headers=H)).status_code == 200
        await login(friend, "sam", FRIEND_PW)

        assert (await client.delete(f"/api/admin/users/{sam}", headers=H)).status_code == 204
        assert (await friend.get("/api/auth/me")).status_code == 401
        assert (await client.delete(f"/api/admin/users/{sam}", headers=H)).status_code == 404


@pytest.mark.db
async def test_owner_name_keeps_its_capitals(
    client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from rack.config import get_settings

    monkeypatch.setattr(get_settings(), "rack_owner_username", "Outis")
    await login(client, username="Outis")  # usernames are case-insensitive
    me = (await client.get("/api/auth/me")).json()
    assert (me["username"], me["display_name"]) == ("outis", "Outis")
