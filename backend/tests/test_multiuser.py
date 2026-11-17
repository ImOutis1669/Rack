"""v2.1 step 2: per-user data. User A must never read or change user B's anything (IDOR),
scoring and the search plan are per user, friends have caps, and migration 0020 hands the
single-user data to the owner."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack import models
from rack.ingest import upsert_listings
from rack.models import (
    DesignerRow,
    FeedbackRow,
    HiddenRow,
    HuntRow,
    ListingScoreRow,
    NotificationRow,
    PushSubscriptionRow,
    SavedRow,
    SeenRow,
    TasteItemRow,
    UserRow,
)
from rack.notify.dispatch import build_channels
from rack.ranking.planner import merge_plans
from rack.sources.base import Category, Listing, SearchQuery
from tests.conftest import BACKEND, OWNER, PASSWORD, login, make_user, password_hash
from tests.test_phase2_db import FakeEmbedder, png

H = {"X-Requested-With": "rack"}
FRIEND = "sam"

# Routes anyone may call without logging in. Everything else under /api must answer 401.
PUBLIC = {
    ("GET", "/api/health"),
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/token"),
    ("POST", "/api/auth/logout"),
    ("POST", "/api/auth/signup"),
}

# Every table with an owner column, and where the IDOR test below checks it. Adding a personal
# table without adding it here (and a check) fails test_every_owned_table_is_checked.
OWNED = {
    "profile": "profile/designers/adjacent",
    "designers": "profile/designers/adjacent",
    "adjacent_designers": "profile/designers/adjacent",
    "taste_items": "taste items",
    "listing_scores": "feed scores",
    "feedback": "votes",
    "saved": "saved",
    "seen": "seen",
    "hidden": "hidden",
    "hunts": "hunts",
    "notifications": "recent alerts",
    "push_subscriptions": "push",
    "user_state": "visits",
    "search_requests": "live search (tests/test_search.py)",
}


def _listing(sid: str, title: str, brand: str = "Rick Owens") -> Listing:
    return Listing(
        source="vinted",
        source_id=sid,
        url=f"https://www.vinted.co.uk/items/{sid}-x",
        title=title,
        brand=brand,
        price=Decimal("100"),
        currency="GBP",
        price_gbp=Decimal("100"),
        images=[f"https://images1.vinted.net/t/{sid}/f800/a.jpeg"],
    )


@asynccontextmanager
async def browser(client: httpx.AsyncClient) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=client._transport, base_url="http://test") as c:
        yield c


# --- every route needs a login ---


def test_every_api_route_needs_login_except_the_public_ones() -> None:
    from fastapi.routing import APIRoute

    from rack.api.auth import require_user
    from rack.api.main import create_app

    def deps(call: object, route: APIRoute) -> set[object]:
        out: set[object] = set()
        stack = list(route.dependant.dependencies)
        while stack:
            d = stack.pop()
            out.add(d.call)
            stack.extend(d.dependencies)
        return out

    app = create_app(static_dir=Path("."))
    missing = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api"):
            continue
        for method in route.methods:
            if (method, route.path) in PUBLIC:
                continue
            if require_user not in deps(route.endpoint, route):
                missing.append((method, route.path))
    assert missing == []


@pytest.mark.db
async def test_routes_answer_401_without_credentials(client: httpx.AsyncClient) -> None:
    from fastapi.routing import APIRoute

    app = client._transport.app  # type: ignore[attr-defined]
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api"):
            continue
        path = route.path.replace("{", "").replace("}", "")
        path = "/".join("1" if p.endswith("_id") or p == "image_id" else p for p in path.split("/"))
        for method in route.methods:
            if (method, route.path) in PUBLIC or route.path.startswith("/api/_test"):
                continue
            r = await client.request(method, path, headers=H)
            assert r.status_code == 401, (method, route.path, r.status_code)


def test_every_owned_table_is_checked() -> None:
    owned = {
        t.name
        for t in models.Base.metadata.sorted_tables
        if "user_id" in t.c and t.name not in ("invites",)
    }
    assert owned == set(OWNED)


# --- IDOR: A can't see or touch B's things ---


@pytest.mark.db
async def test_user_a_cannot_read_or_change_user_b_data(
    client: httpx.AsyncClient,
    sessions: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner_id = await make_user(sessions, OWNER, "owner")
    sam_id = await make_user(sessions, FRIEND, password="sam-password-long")
    async with sessions() as s:
        lid, other = await upsert_listings(
            s, [_listing("1", "Rick Owens geobasket"), _listing("2", "Margiela tabi", "Margiela")]
        )
        await s.commit()

    # --- B (the friend) makes one of everything ---
    async with browser(client) as b:
        await login(b, FRIEND, "sam-password-long")
        await b.put("/api/designers", json=[{"name": "Rick Owens", "weight": "love"}], headers=H)
        prof = (await b.get("/api/profile")).json()["profile"]
        prof["context"] = "sam's private taste"
        assert (await b.put("/api/profile", json=prof, headers=H)).status_code == 200
        b_item = (
            await b.post(
                "/api/taste/upload",
                data={"kind": "wardrobe", "text": "sam's jacket"},
                files=[("files", ("a.png", png("black"), "image/png"))],
                headers=H,
            )
        ).json()[0]
        b_text = (
            await b.post("/api/taste/text", json={"kind": "wishlist", "text": "tabi"}, headers=H)
        ).json()
        assert (await b.put(f"/api/listings/{lid}/saved", headers=H)).status_code == 204
        r = await b.post(f"/api/listings/{lid}/feedback", json={"value": 1}, headers=H)
        assert r.status_code == 204
        b_hidden = (
            await b.post("/api/hidden", json={"kind": "brand", "value": "Margiela"}, headers=H)
        ).json()
        hunt_body = {"name": "Geo", "query": "geobasket", "interval_minutes": 60}
        b_hunt = (await b.post("/api/hunts", json=hunt_body, headers=H)).json()
        sub = {"endpoint": "https://push.example/sam", "keys": {"p256dh": "k", "auth": "a"}}
        assert (await b.post("/api/push/subscribe", json=sub, headers=H)).status_code == 204
        await b.post("/api/seen", json={"ids": [lid]}, headers=H)
        await b.post("/api/visit", headers=H)
    async with sessions() as s:
        s.add(
            NotificationRow(
                user_id=sam_id, key="hunt:x", kind="hunt", title="sam's alert", body="b"
            )
        )
        s.add(
            ListingScoreRow(
                user_id=sam_id,
                listing_id=lid,
                score=0.9,
                why="sam's why",
                components={},
                measurements={},
                profile_version=1,
            )
        )
        await s.commit()

    # --- A (the owner) tries everything with B's ids ---
    await login(client)
    assert (await client.get("/api/designers")).json() == []
    assert (await client.get("/api/adjacent")).json() == {}
    assert "sam" not in (await client.get("/api/profile")).json()["profile"]["context"]
    assert (await client.get("/api/taste")).json() == []
    for item in (b_item, b_text):
        i = item["id"]
        assert (
            await client.patch(f"/api/taste/{i}", json={"note": "x"}, headers=H)
        ).status_code == 404
        assert (await client.get(f"/api/taste/{i}/image")).status_code == 404
        assert (await client.get(f"/api/taste/{i}/thumb")).status_code == 404
        assert (await client.get(f"/api/taste/{i}/comparables")).status_code == 404
        assert (await client.post(f"/api/taste/{i}/undo-bought", headers=H)).status_code == 404
        assert (await client.delete(f"/api/taste/{i}", headers=H)).status_code == 404
    assert (await client.get("/api/saved")).json() == []
    feed = (await client.get("/api/feed?sort=newest")).json()["items"]
    mine = {f["id"]: f for f in feed}
    assert mine[lid]["saved"] is False and mine[lid]["feedback"] is None
    assert mine[lid]["why"] is None  # B's score isn't A's
    assert other in mine  # B's hidden brand doesn't hide anything for A
    assert (await client.get("/api/hidden")).json() == []
    assert (await client.delete(f"/api/hidden/{b_hidden['id']}", headers=H)).status_code == 204
    assert (await client.get("/api/hunts")).json() == []
    h = b_hunt["id"]
    assert (await client.get(f"/api/hunts/{h}/matches")).status_code == 404
    assert (await client.put(f"/api/hunts/{h}", json=hunt_body, headers=H)).status_code == 404
    assert (await client.post(f"/api/hunts/{h}/run", headers=H)).status_code == 404
    assert (await client.delete(f"/api/hunts/{h}", headers=H)).status_code == 404
    assert (await client.get("/api/notify/recent")).json() == []
    statuses = {c["name"]: c for c in (await client.get("/api/notify/status")).json()}
    assert (
        statuses["webpush"]["detail"].startswith("0 device")
        or not statuses["webpush"]["configured"]
    )
    r = await client.post("/api/push/unsubscribe", json={"endpoint": sub["endpoint"]}, headers=H)
    assert r.status_code == 204
    # A's own visit is separate from B's
    assert (await client.post("/api/visit", headers=H)).json()["last_visit"] is None
    # hide_seen_before: B's "seen" doesn't hide anything from A
    later = "2999-01-01T00:00:00Z"
    feed = (await client.get(f"/api/feed?sort=newest&hide_seen_before={later}")).json()["items"]
    assert lid in {f["id"] for f in feed}
    # buying B's saved listing as A doesn't touch B's Saved
    r = await client.post(f"/api/listings/{lid}/bought", json={"price_gbp": "1"}, headers=H)
    assert r.status_code == 200

    # --- B's data is all still there ---
    async with sessions() as s:

        async def count(model: type, **where: object) -> int:
            stmt = select(func.count()).select_from(model)
            for k, v in where.items():
                stmt = stmt.where(getattr(model, k) == v)
            return int((await s.execute(stmt)).scalar_one())

        assert await count(DesignerRow, user_id=sam_id) == 1
        assert await count(TasteItemRow, user_id=sam_id) == 2
        assert await count(SavedRow, user_id=sam_id) == 1
        assert await count(FeedbackRow, user_id=sam_id) == 1
        assert await count(HiddenRow, user_id=sam_id) == 1
        assert await count(HuntRow, user_id=sam_id) == 1
        assert await count(PushSubscriptionRow, user_id=sam_id) == 1
        assert await count(SeenRow, user_id=sam_id) == 1
        assert await count(NotificationRow, user_id=sam_id) == 1
        assert await count(TasteItemRow, user_id=owner_id) == 1  # A's bought item
        ctx = (
            await s.execute(
                text("SELECT data->>'context' FROM profile WHERE user_id = :u"), {"u": sam_id}
            )
        ).scalar()
        assert ctx == "sam's private taste"
    # B's photo file is still on disk
    assert len([p for p in (tmp_path / "data" / "uploads" / str(sam_id)).iterdir()]) == 1

    # --- deleting B removes everything of B's (cascade) ---
    await client.delete(f"/api/admin/users/{sam_id}", headers=H)
    async with sessions() as s:
        for table in OWNED:
            n = (
                await s.execute(
                    text(f"SELECT count(*) FROM {table} WHERE user_id = :u"), {"u": sam_id}
                )
            ).scalar()
            assert n == 0, table


# --- scoring, planning, caps, alerts per user ---


@pytest.mark.db
async def test_scores_are_per_user(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    from rack.worker.taste import rescore

    owner_id = await make_user(sessions, OWNER, "owner")
    sam_id = await make_user(sessions, FRIEND)
    async with sessions() as s:
        await upsert_listings(
            s, [_listing("1", "Rick Owens geobasket"), _listing("2", "Margiela tabi", "Margiela")]
        )
        s.add(HiddenRow(user_id=sam_id, kind="brand", value="Margiela"))
        await s.commit()
    assert await rescore(sessions, FakeEmbedder()) == 4  # 2 listings x 2 users
    async with sessions() as s:
        rows = (await s.execute(select(ListingScoreRow))).scalars().all()
        filtered = {(r.user_id, r.filtered_reason is not None) for r in rows}
    assert (sam_id, True) in filtered  # B hid Margiela...
    assert (owner_id, True) not in filtered  # ...A didn't
    assert await rescore(sessions, FakeEmbedder()) is None  # nothing changed

    from rack.store import bump_version, mark_listings_changed

    async with sessions() as s:  # only listings changed: the owner now, friends throttled
        await mark_listings_changed(s)
        await s.commit()
    assert await rescore(sessions, FakeEmbedder()) == 2
    async with sessions() as s:  # the friend's own taste changed: at once
        await bump_version(s, sam_id)
        await s.commit()
    assert await rescore(sessions, FakeEmbedder()) == 2

    async with sessions() as s:  # a disabled friend isn't scored any more
        from datetime import UTC, datetime

        sam = await s.get(UserRow, sam_id)
        assert sam is not None
        sam.disabled_at = datetime.now(UTC)
        await s.commit()
    assert await rescore(sessions, FakeEmbedder(), force=True) == 2


def test_merge_plans_round_robins_and_dedupes() -> None:
    a = [
        SearchQuery(text="Rick Owens", category=Category.SHOES, max_price_gbp=Decimal(300)),
        SearchQuery(text="Lemaire"),
    ]
    b = [
        SearchQuery(text="rick  owens", category=Category.SHOES, max_price_gbp=Decimal(500)),
        SearchQuery(text="Kapital", max_price_gbp=Decimal(100)),
        SearchQuery(text="Lemaire", max_price_gbp=Decimal(50)),
    ]
    out = merge_plans([a, b])
    assert [(q.text, q.max_price_gbp) for q in out] == [
        ("Rick Owens", Decimal(500)),  # same search: higher cap
        ("Lemaire", None),  # no cap beats a cap
        ("Kapital", Decimal(100)),
    ]
    assert merge_plans([]) == []


@pytest.mark.db
async def test_planner_merges_active_users(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    from rack.worker.main import plan_queries

    owner_id = await make_user(sessions, OWNER, "owner")
    sam_id = await make_user(sessions, FRIEND)
    async with sessions() as s:
        s.add(DesignerRow(user_id=owner_id, name="Lemaire", weight="like"))
        s.add(DesignerRow(user_id=sam_id, name="Kapital", weight="like"))
        await s.commit()
    got = {q.text for q in await plan_queries(size=10)}
    assert {"Lemaire", "Kapital"} <= got


@pytest.mark.db
async def test_friends_hunt_caps(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await make_user(sessions, OWNER, "owner")
    await make_user(sessions, FRIEND, password="sam-password-long")
    body = {"name": "Geo", "query": "geobasket", "interval_minutes": 60}
    async with browser(client) as b:
        await login(b, FRIEND, "sam-password-long")
        r = await b.post("/api/hunts", json={**body, "interval_minutes": 30}, headers=H)
        assert r.status_code == 400  # friends: every 60 min at most
        ids = [(await b.post("/api/hunts", json=body, headers=H)).json()["id"] for _ in range(5)]
        assert (await b.post("/api/hunts", json=body, headers=H)).status_code == 400  # 5 max
        async with sessions() as s:
            from datetime import UTC, datetime

            hunt = await s.get(HuntRow, ids[0])
            assert hunt is not None
            hunt.last_run_at = datetime.now(UTC)
            await s.commit()
        assert (await b.post(f"/api/hunts/{ids[0]}/run", headers=H)).status_code == 429
        assert (await b.post(f"/api/hunts/{ids[1]}/run", headers=H)).status_code == 200
    await login(client)  # the owner has no caps
    assert (
        await client.post("/api/hunts", json={**body, "interval_minutes": 15}, headers=H)
    ).status_code == 200


def test_friends_only_get_web_push(monkeypatch: pytest.MonkeyPatch) -> None:
    from rack.config import Settings

    s = Settings(
        ntfy_topic="t",
        telegram_bot_token="b",
        telegram_chat_id="c",
        vapid_public_key="pub",
        vapid_private_key="priv",
    )
    sessions = object()  # only checked for "is not None"
    owner = {c.name for c in build_channels(s, sessions, user_id=1, owner=True)}  # type: ignore[arg-type]
    friend = {c.name for c in build_channels(s, sessions, user_id=2, owner=False)}  # type: ignore[arg-type]
    assert owner == {"ntfy", "telegram", "webpush"}
    assert friend == {"webpush"}


@pytest.mark.db
async def test_sources_usage_line_is_owner_only(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    from rack.sources.ebay import quota_day
    from rack.store import set_state

    await make_user(sessions, OWNER, "owner")
    await make_user(sessions, FRIEND, password="sam-password-long")
    async with sessions() as s:
        await set_state(s, "ebay_usage", {"day": quota_day(), "search": 10})
        await s.commit()
    await login(client)
    ebay = next(
        h for h in (await client.get("/api/sources/health")).json() if h["source"] == "ebay"
    )
    assert ebay["usage"]
    async with browser(client) as b:
        await login(b, FRIEND, "sam-password-long")
        rows = (await b.get("/api/sources/health")).json()
        assert len(rows) == 3  # friends see Sources...
        assert next(h for h in rows if h["source"] == "ebay")["usage"] is None  # ...not the quota


# --- migration 0020 on single-user data ---


@pytest.mark.db
async def test_migration_0020_gives_single_user_data_to_the_owner(
    pg_url: str, sessions: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    from alembic import command
    from alembic.config import Config

    from rack.config import get_settings

    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.set_main_option("sqlalchemy.url", pg_url)
    try:
        await _run(command.downgrade, cfg, "0019")
        async with sessions() as s:
            await s.execute(text("DELETE FROM users"))
            lid = (
                await s.execute(
                    text(
                        "INSERT INTO listings (source, source_id, url, title, price, currency, raw,"
                        " active, first_seen_at, last_seen_at) VALUES ('vinted', '1', 'u', 't', 1,"
                        " 'GBP', '{}', true, now(), now()) RETURNING id"
                    )
                )
            ).scalar_one()
            await s.execute(
                text(
                    "INSERT INTO profile (id, data, version, updated_at) VALUES (1, '{}', 7, now())"
                )
            )
            await s.execute(
                text("INSERT INTO saved (listing_id, saved_at) VALUES (:l, now())"), {"l": lid}
            )
            await s.execute(text("INSERT INTO designers (name, weight) VALUES ('Lemaire', 'love')"))
            await s.execute(
                text(
                    "INSERT INTO app_state (key, value) VALUES ('auth', '{\"epoch\": 4}'), "
                    "('visit', '{\"current\": \"x\"}')"
                )
            )
            await s.commit()
        monkeypatch.setenv("RACK_PASSWORD_HASH", password_hash())
        monkeypatch.setenv("RACK_OWNER_USERNAME", "The.Boss")
        get_settings.cache_clear()
        await _run(command.upgrade, cfg, "head")
        async with sessions() as s:
            owner = (await s.execute(select(UserRow))).scalar_one()
            assert (owner.username, owner.role, owner.session_epoch) == ("the.boss", "owner", 4)
            for table in ("profile", "saved", "designers"):
                users = (
                    (await s.execute(text(f"SELECT DISTINCT user_id FROM {table}"))).scalars().all()
                )
                assert users == [owner.id], table
            visit = (
                await s.execute(text("SELECT value FROM user_state WHERE key = 'visit'"))
            ).scalar_one()
            assert visit == {"current": "x"}
            assert (
                await s.execute(
                    text("SELECT count(*) FROM app_state WHERE key IN ('visit', 'auth')")
                )
            ).scalar() == 0
        # and the owner can log in with the old password
        assert owner.password_hash == password_hash()
    finally:
        get_settings.cache_clear()
        await _run(command.upgrade, cfg, "head")
    _ = PASSWORD


async def _run(fn: object, cfg: object, rev: str) -> None:
    """Alembic's env.py runs its own event loop, so call it from a worker thread."""
    import asyncio

    await asyncio.to_thread(fn, cfg, rev)  # type: ignore[arg-type]


_ = inspect
