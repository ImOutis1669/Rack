import json
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from rack.config import Settings
from rack.ingest import upsert_listings
from rack.ranking.llm import (
    Candidate,
    adjusted_score,
    build_content,
    judge,
    parse_verdicts,
    taste_summary,
)
from rack.sources.base import Listing
from rack.worker.llm_job import llm_rerank
from rack.worker.taste import rescore
from tests.conftest import login


class FakeMessages:
    def __init__(
        self, verdicts: list[dict[str, Any]], fail_images: bool = False, refuse: bool = False
    ) -> None:
        self.calls: list[dict[str, Any]] = []
        self.verdicts, self.fail_images, self.refuse = verdicts, fail_images, refuse

    async def create(self, **kw: Any) -> Any:
        self.calls.append(kw)
        has_image = any(b["type"] == "image" for b in kw["messages"][0]["content"])
        if self.fail_images and has_image:
            import anthropic

            req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
            raise anthropic.BadRequestError(
                "Could not process image", response=httpx.Response(400, request=req), body=None
            )
        if self.refuse:
            return SimpleNamespace(stop_reason="refusal", stop_details=None, content=[])
        text = json.dumps({"verdicts": self.verdicts})
        return SimpleNamespace(
            stop_reason="end_turn", content=[SimpleNamespace(type="text", text=text)]
        )


class FakeClient:
    def __init__(self, messages: FakeMessages) -> None:
        self.beta = SimpleNamespace(messages=messages)


def cand(i: int, image: str | None = "https://img/x.jpg") -> Candidate:
    return Candidate(i, f"Item {i}", "Lemaire", 120.0, "M", "Very good", {"sleeve_cm": 66.0}, image)


def test_prompt_pieces() -> None:
    text = taste_summary(
        "dark, draped",
        {"Rick Owens": "love", "Gucci": "exclude"},
        ["black derbies"],
        ["long coat"],
        {"inseam_min_cm": 86.0, "sleeve_min_cm": None},
        {"trousers": ["32"]},
    )
    assert "Designers they love: Rick Owens" in text and "Never: Gucci" in text
    assert "inseam ≥ 86 cm" in text and "sleeve" not in text
    content = build_content([cand(1), cand(2, image=None)], with_images=True)
    assert [b["type"] for b in content] == ["image", "text", "text", "text"]
    assert (
        content[1]["text"]
        == "id 1: Item 1 · brand Lemaire · £120 · size M · Very good · sleeve 66cm"
    )


def test_parse_and_blend() -> None:
    v = parse_verdicts(
        json.dumps(
            {
                "verdicts": [
                    {"id": 1, "score": 14, "why": "  long   wool coat "},
                    {"id": 99, "score": 5, "why": "x"},
                ]
            }
        ),
        {1},
    )
    assert len(v) == 1 and v[0].score == 10 and v[0].why == "long wool coat"
    assert adjusted_score(0.6, 10, 0.3) == pytest.approx(0.75)
    assert adjusted_score(0.6, 5, 0.3) == pytest.approx(0.6)
    assert adjusted_score(0.6, None, 0.3) == 0.6


async def test_judge_uses_opus_structured_output_and_fallback() -> None:
    m = FakeMessages([{"id": 1, "score": 8, "why": "drape"}])
    out = await judge(FakeClient(m), "claude-opus-5-5", "profile", [cand(1)])
    assert out[0].score == 8
    kw = m.calls[0]
    assert kw["model"] == "claude-opus-5-5"
    assert kw["fallbacks"] == "default" and kw["betas"] == ["server-side-fallback-2026-07-01"]
    assert kw["output_config"]["format"]["type"] == "json_schema"
    assert "thinking" not in kw  # Opus 5.5: thinking is always on; effort controls depth


async def test_judge_retries_without_photos_and_handles_refusal() -> None:
    m = FakeMessages([{"id": 1, "score": 6, "why": "ok"}], fail_images=True)
    assert len(await judge(FakeClient(m), "claude-opus-5-5", "p", [cand(1)])) == 1
    assert len(m.calls) == 2
    assert (
        await judge(FakeClient(FakeMessages([], refuse=True)), "claude-opus-5-5", "p", [cand(1)])
        == []
    )


@pytest.mark.db
async def test_rerank_job_scores_once_and_survives_rescore(
    client: httpx.AsyncClient, sessions: async_sessionmaker[AsyncSession]
) -> None:
    await login(client)
    listings = [
        Listing(
            source="vinted",
            source_id=str(i),
            url=f"https://www.vinted.co.uk/items/{i}",
            title=f"Coat {i}",
            price=Decimal(100),
            currency="GBP",
            price_gbp=Decimal(100),
            images=[f"https://img/{i}.jpg"],
        )
        for i in (1, 2)
    ]
    async with sessions() as s:
        ids = await upsert_listings(s, listings)
        await s.commit()
    await rescore(sessions, None)
    settings = Settings(llm_enabled=True, llm_daily_call_cap=5, llm_weight=0.3)
    m = FakeMessages([{"id": ids[1], "score": 10, "why": "Perfect long wool overcoat"}])
    assert await llm_rerank(sessions, settings, FakeClient(m)) == 1
    # the item it didn't judge is asked about again; the judged one isn't re-sent
    assert await llm_rerank(sessions, settings, FakeClient(m)) == 0
    assert len(m.calls) == 2
    second = m.calls[1]["messages"][0]["content"]
    sent = [b["text"].split(":")[0] for b in second if b["type"] == "text"][:-1]
    assert sent == [f"id {ids[0]}"]

    items = (await client.get("/api/feed")).json()["items"]
    assert items[0]["id"] == ids[1] and items[0]["why"].startswith("Perfect long wool overcoat")

    await rescore(sessions, None, force=True)  # verdict is re-applied, not lost
    items = (await client.get("/api/feed")).json()["items"]
    assert items[0]["id"] == ids[1] and items[0]["why"].startswith("Perfect long wool overcoat")
