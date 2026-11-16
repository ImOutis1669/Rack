"""Optional LLM re-rank: Claude looks at the top of the feed (photos + details) against your taste
profile and gives each listing a 0-10 verdict and a one-line reason.

Off unless LLM_ENABLED=true and an Anthropic API key is set. Each listing is judged at most once per
LLM_VERDICT_DAYS, only the top LLM_TOP_N are sent, and calls are capped per day.
"""

import json
import logging
from dataclasses import dataclass
from typing import Any, Protocol

import anthropic

log = logging.getLogger(__name__)

SYSTEM = """You help one person shop second-hand menswear. You see their taste profile and a \
batch of listings (photo + details). For each listing, judge how well it suits *this person*: \
their style, the designers they like, their wardrobe and wishlist, and their fit needs. Price \
matters only relative to what the piece is. Unknown or unbranded items are judged on how they \
look, never marked down for lacking a brand. Be honest: most listings are a 3-6.

Return one verdict per listing id: a score from 0 to 10 and a reason of at most 15 words that \
names something specific you can see or read (cut, fabric, colour, detail, fit). No hype."""

VERDICT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verdicts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "score": {"type": "integer"},
                    "why": {"type": "string"},
                },
                "required": ["id", "score", "why"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["verdicts"],
    "additionalProperties": False,
}


@dataclass
class Candidate:
    id: int
    title: str
    brand: str | None
    price_gbp: float | None
    size: str | None
    condition: str | None
    measurements: dict[str, float]
    image_url: str | None


@dataclass
class Verdict:
    id: int
    score: float  # 0..10
    why: str


def taste_summary(
    context: str,
    designers: dict[str, str],
    wishlist: list[str],
    wardrobe_labels: list[str],
    fit: dict[str, float | None],
    sizes: dict[str, list[str]],
) -> str:
    lines = []
    if context.strip():
        lines.append(f"Style in their words: {context.strip()}")
    for weight in ("love", "like", "curious"):
        names = [n for n, w in designers.items() if w == weight]
        if names:
            lines.append(f"Designers they {weight}: {', '.join(names)}")
    excluded = [n for n, w in designers.items() if w == "exclude"]
    if excluded:
        lines.append(f"Never: {', '.join(excluded)}")
    if wardrobe_labels:
        lines.append(f"Owns and loves: {'; '.join(wardrobe_labels[:20])}")
    if wishlist:
        lines.append(f"Wants: {'; '.join(wishlist[:20])}")
    needs = [
        f"{k.replace('_min_cm', '').replace('_', ' ')} ≥ {v:g} cm" for k, v in fit.items() if v
    ]
    if needs:
        lines.append(f"Fit needs (minimum lengths, so long cuts matter): {', '.join(needs)}")
    for cat, s in sizes.items():
        if s:
            lines.append(f"{cat} sizes: {', '.join(s)}")
    return "\n".join(lines) or "No profile yet; judge on general quality and versatility."


def listing_text(c: Candidate) -> str:
    bits = [f"id {c.id}: {c.title}"]
    if c.brand:
        bits.append(f"brand {c.brand}")
    if c.price_gbp is not None:
        bits.append(f"£{c.price_gbp:.0f}")
    if c.size:
        bits.append(f"size {c.size}")
    if c.condition:
        bits.append(c.condition)
    if c.measurements:
        bits.append(", ".join(f"{k.replace('_cm', '')} {v:g}cm" for k, v in c.measurements.items()))
    return " · ".join(bits)


def build_content(candidates: list[Candidate], with_images: bool) -> list[dict[str, Any]]:
    content: list[dict[str, Any]] = []
    for c in candidates:
        if with_images and c.image_url:
            content.append({"type": "image", "source": {"type": "url", "url": c.image_url}})
        content.append({"type": "text", "text": listing_text(c)})
    content.append({"type": "text", "text": "Give one verdict per listing id above."})
    return content


def parse_verdicts(text: str, ids: set[int]) -> list[Verdict]:
    data = json.loads(text)
    out: list[Verdict] = []
    for v in data.get("verdicts", []):
        if not isinstance(v, dict) or v.get("id") not in ids:
            continue
        score = max(0.0, min(10.0, float(v.get("score", 0))))
        out.append(Verdict(int(v["id"]), score, " ".join(str(v.get("why", "")).split())[:160]))
    return out


def adjusted_score(score: float, llm_score: float | None, weight: float) -> float:
    """Blend: a 10/10 adds weight/2, a 0/10 subtracts weight/2, 5/10 changes nothing."""
    if llm_score is None:
        return score
    return score + weight * (llm_score / 10 - 0.5)


class MessagesClient(Protocol):
    """The slice of anthropic.AsyncAnthropic that we use (lets tests pass a fake)."""

    @property
    def beta(self) -> Any: ...


async def judge(
    client: MessagesClient, model: str, profile_text: str, candidates: list[Candidate]
) -> list[Verdict]:
    """One request for the whole batch. Retries once without photos if an image can't be fetched."""
    ids = {c.id for c in candidates}
    last_error: Exception | None = None
    for with_images in (True, False):
        try:
            response = await client.beta.messages.create(
                model=model,
                max_tokens=16000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",  # if a safety classifier declines, another model answers
                output_config={
                    "effort": "low",
                    "format": {"type": "json_schema", "schema": VERDICT_SCHEMA},
                },
                cache_control={"type": "ephemeral"},
                system=[
                    {"type": "text", "text": SYSTEM},
                    {"type": "text", "text": f"Taste profile:\n{profile_text}"},
                ],
                messages=[{"role": "user", "content": build_content(candidates, with_images)}],
            )
        except anthropic.BadRequestError as exc:
            # usually Anthropic couldn't fetch a marketplace photo URL: retry with text only
            if not with_images:
                raise
            last_error = exc
            log.info("LLM re-rank with photos was rejected (%s); retrying text-only", exc.message)
            continue
        if response.stop_reason == "refusal":
            log.info("LLM re-rank declined: %s", response.stop_details)
            return []
        text = next((b.text for b in response.content if b.type == "text"), "")
        return parse_verdicts(text, ids)
    if last_error:
        raise last_error
    return []
