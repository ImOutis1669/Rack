"""Daily reachability check for sources that currently refuse Rack (no adapter runs for them).

One plain GET per source per day, honest User-Agent. Nothing here tries to get past bot protection;
if a site starts answering normally, source health says so and an adapter can be written.
"""

import httpx

from rack.sources.http import USER_AGENT

# source -> page that a real adapter would need
BLOCKED_SOURCES: dict[str, str] = {
    "vestiaire": "https://www.vestiairecollective.com/search/?q=rick%20owens",
}
CHALLENGE_MARKERS = (
    "attention required",
    "just a moment",
    "cf-chl",
    "turnstile",
    "captcha",
    "verify you are human",
)


def classify(status: int, body: str) -> tuple[bool, str]:
    """(blocked, human-readable detail) from one response."""
    low = body[:20000].lower()
    marker = next((m for m in CHALLENGE_MARKERS if m in low), None)
    if status in (401, 403, 429, 503) or marker:
        why = f"challenge page ({marker})" if marker else "request refused"
        return True, f"Blocked by the site's bot protection: HTTP {status}, {why}. Rechecked daily."
    if status == 200:
        return (
            False,
            "Site answered normally on the last check; no adapter yet (ask Claude to add one).",
        )
    return True, f"Unexpected HTTP {status} on the daily check."


async def check(url: str, transport: httpx.AsyncBaseTransport | None = None) -> tuple[bool, str]:
    async with httpx.AsyncClient(
        headers={"User-Agent": USER_AGENT, "Accept-Language": "en-GB"},
        timeout=20,
        follow_redirects=True,
        transport=transport,
    ) as client:
        try:
            resp = await client.get(url)
        except httpx.HTTPError as exc:
            return True, f"Daily check failed: {type(exc).__name__}: {exc}"
        return classify(resp.status_code, resp.text)
