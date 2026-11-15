"""Match a listing's brand/title against the designer list."""

import re
import unicodedata

STYLE_WORDS = ("style", "inspired", "type", "look", "esque", "vibe", "alike")


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _contains(haystack: str, needle: str) -> bool:
    return bool(needle) and re.search(rf"(?:^| ){re.escape(needle)}(?: |$)", haystack) is not None


def match_designer(brand: str | None, title: str, designers: list[str]) -> str | None:
    """Return the designer name that this listing is by, if any.

    Brand field wins; otherwise the designer must appear in the title *not* followed by a
    "style/inspired" word (that's a look-alike, handled by `is_style_reference`).
    """
    b = normalize(brand or "")
    t = normalize(title)
    # longest names first so "maison margiela" beats "margiela" (both fine) and avoids partials
    for name in sorted(designers, key=len, reverse=True):
        n = normalize(name)
        if b and (_contains(b, n) or _contains(n, b)):
            return name
    for name in sorted(designers, key=len, reverse=True):
        n = normalize(name)
        if _contains(t, n) and not is_style_reference(title, name):
            return name
    return None


def is_style_reference(title: str, designer: str) -> bool:
    """'Margiela style tabi' / 'rick owens inspired' -> True."""
    t, n = normalize(title), normalize(designer)
    return any(_contains(t, f"{n} {w}") for w in STYLE_WORDS)


def mentions_style_of(title: str, designers: list[str]) -> str | None:
    for name in designers:
        if is_style_reference(title, name):
            return name
    return None
