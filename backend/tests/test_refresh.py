"""The Refresh button (v2.1): each person's own searches, own cooldown, own results."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.models import DesignerRow, UserRow
from rack.profile import Budget, Profile
from rack.ranking.planner import PlannerInput, tailored_batch, tailored_streams
from rack.sources.base import Category
from rack.store import get_user_state, set_user_state
from tests.conftest import OWNER, login, make_user
from tests.test_multiuser import FRIEND, H, browser


def _input() -> PlannerInput:
    profile = Profile(
        categories=[Category.TOPS, Category.SHOES],
        budget=Budget(default_max_gbp=400, per_category={Category.SHOES: 600}),
    )
    designers = {
        "Number Nine": "love",
        "Rick Owens": "love",
        "Lemaire": "like",
        "Kapital": "curious",
        "Gucci": "exclude",
    }
    adjacent = {"Rick Owens": ["Julius", "Gucci", "Lemaire"]}
    return PlannerInput(profile, designers, adjacent, ["margiela tabi", "  "])


def test_streams_put_loved_designers_first_and_skip_excluded() -> None:
    streams = tailored_streams(_input())
    assert [(q.text, q.category, q.max_price_gbp) for q in streams["love"]] == [
        ("Number Nine", Category.TOPS, Decimal(400)),  # category-major: a batch spans designers
        ("Rick Owens", Category.TOPS, Decimal(400)),
        ("Number Nine", Category.SHOES, Decimal(600)),
        ("Rick Owens", Category.SHOES, Decimal(600)),
    ]
    assert [q.text for q in streams["wish"]] == ["margiela tabi"]
    # liked, then curious, then adjacent; never an excluded or already-listed designer
    assert [q.text for q in streams["more"]] == ["Lemaire", "Kapital", "Julius"]


def test_batches_follow_the_slots_and_move_on() -> None:
    streams = tailored_streams(_input())
    first, cur = tailored_batch(streams, {}, 4)
    assert [(q.text, q.category) for q in first] == [
        ("Number Nine", Category.TOPS),
        ("Rick Owens", Category.TOPS),
        ("margiela tabi", Category.ANY),
        ("Lemaire", Category.ANY),
    ]
    second, cur = tailored_batch(streams, cur, 4)
    assert [(q.text, q.category) for q in second] == [
        ("Number Nine", Category.SHOES),
        ("Rick Owens", Category.SHOES),
        ("margiela tabi", Category.ANY),  # the only wishlist text comes round every time
        ("Kapital", Category.ANY),
    ]
    third, _ = tailored_batch(streams, cur, 4)
    assert [q.text for q in third][:2] == ["Number Nine", "Rick Owens"]  # wrapped round
    assert third[3].text == "Julius"


def test_empty_streams_give_their_slots_away_without_repeats() -> None:
    inp = _input()
    only_likes = PlannerInput(Profile(), {"Lemaire": "like", "Kapital": "like"}, {}, [])
    batch, _ = tailored_batch(tailored_streams(only_likes), {}, 4)
    assert [q.text for q in batch] == ["Lemaire", "Kapital"]  # two searches, not four
    assert tailored_batch(tailored_streams(PlannerInput(Profile(), {}, {}, [])), {}, 4)[0] == []
    batch, _ = tailored_batch(tailored_streams(inp), {}, 12)
    keys = [(q.text, q.category) for q in batch]
    assert len(keys) == len(set(keys)) == 8  # everything once, nothing twice


@pytest.mark.db
async def test_refresh_is_per_person_with_its_own_cooldown(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    owner_id = await make_user(sessions, OWNER, "owner")
    sam_id = await make_user(sessions, FRIEND, password="sam-password-long")
    await login(client)
    r = (await client.post("/api/refresh", headers=H)).json()
    assert r["queued"] and r["message"] == "Searching your designers now."
    assert (await client.post("/api/refresh", headers=H)).json()["message"].startswith("Already")

    async with browser(client) as b:  # the owner's request doesn't hold up a friend
        await login(b, FRIEND, "sam-password-long")
        assert not (await b.get("/api/refresh")).json()["queued"]
        assert (await b.post("/api/refresh", headers=H)).json()["queued"]

        asked = datetime.now(UTC) - timedelta(minutes=6)
        async with sessions() as s:  # both ran 6 minutes ago
            for uid in (owner_id, sam_id):
                await set_user_state(
                    s,
                    uid,
                    "refresh",
                    {
                        "requested_at": asked.isoformat(),
                        "started_at": (asked + timedelta(seconds=5)).isoformat(),
                    },
                )
            await s.commit()
        assert (await client.post("/api/refresh", headers=H)).json()["queued"]  # owner: 5 min
        friend = (await b.post("/api/refresh", headers=H)).json()  # friends: 15 min
        assert not friend["queued"] and "try again in ~9 min" in friend["message"]


@pytest.mark.db
async def test_worker_runs_the_oldest_request_with_the_askers_own_searches(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    from rack.worker.main import next_refresh_request, tailored_queries

    owner_id = await make_user(sessions, OWNER, "owner")
    sam_id = await make_user(sessions, FRIEND)
    kim_id = await make_user(sessions, "kim")
    now = datetime.now(UTC)
    async with sessions() as s:
        s.add(DesignerRow(user_id=owner_id, name="Lemaire", weight="love"))
        s.add(DesignerRow(user_id=sam_id, name="Kapital", weight="love"))
        await set_user_state(s, owner_id, "refresh", {"requested_at": now.isoformat()})
        older = (now - timedelta(seconds=30)).isoformat()
        await set_user_state(s, sam_id, "refresh", {"requested_at": older})
        oldest = (now - timedelta(seconds=60)).isoformat()
        await set_user_state(s, kim_id, "refresh", {"requested_at": oldest})
        kim = await s.get(UserRow, kim_id)
        assert kim is not None
        kim.disabled_at = now  # disabled: their request never runs
        await s.commit()
    assert await next_refresh_request() == sam_id

    assert {q.text for q in await tailored_queries(sam_id, 4)} == {"Kapital"}
    assert {q.text for q in await tailored_queries(owner_id, 4)} == {"Lemaire"}
    async with sessions() as s:  # the cursor is stored with the request, which is kept
        st = await get_user_state(s, sam_id, "refresh")
    assert st["requested_at"] == older and "cursors" in st

    async with sessions() as s:  # once started, the request is done
        await set_user_state(s, sam_id, "refresh", {**st, "started_at": now.isoformat()})
        await s.commit()
    assert await next_refresh_request() == owner_id
