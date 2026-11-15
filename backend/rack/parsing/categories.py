"""Infer a listing's category and match sizes, from title text."""

import re

from rack.sources.base import Category

# Order matters: outerwear before tops ("shirt jacket"), shoes before trousers ("boot cut" is rare).
KEYWORDS: list[tuple[Category, tuple[str, ...]]] = [
    (
        Category.OUTERWEAR,
        (
            "jacket",
            "coat",
            "parka",
            "bomber",
            "blazer",
            "gilet",
            "trench",
            "anorak",
            "overcoat",
            "peacoat",
            "puffer",
            "windbreaker",
            "overshirt",
            "shacket",
        ),
    ),
    (
        Category.SHOES,
        (
            "shoe",
            "boot",
            "sneaker",
            "trainer",
            "derby",
            "derbies",
            "loafer",
            "sandal",
            "geobasket",
            "ramones",
            "tabi",
            "oxford",
            "brogue",
            "mule",
            "clog",
            "slipper",
            "dunk",
            "runner",
        ),
    ),
    (
        Category.TROUSERS,
        ("trouser", "pant", "jean", "chino", "cargo", "jogger", "slacks", "shorts", "denim"),
    ),
    (
        Category.TOPS,
        (
            "t-shirt",
            "tshirt",
            "tee",
            "shirt",
            "knit",
            "jumper",
            "sweater",
            "hoodie",
            "sweatshirt",
            "polo",
            "cardigan",
            "top",
            "vest",
            "tank",
            "henley",
            "crewneck",
        ),
    ),
]


def infer_category(title: str) -> Category:
    t = title.lower()
    for category, words in KEYWORDS:
        if any(re.search(rf"\b{re.escape(w)}s?\b", t) for w in words):
            return category
    return Category.ANY


def _norm_size(s: str) -> str:
    s = s.lower().replace("uk", "").replace("eu", "").replace("size", "")
    s = re.sub(r"[^a-z0-9.]", "", s)
    return {"xxl": "2xl", "xxxl": "3xl", "xxs": "2xs"}.get(s, s)


def size_tokens(size: str) -> set[str]:
    parts = re.split(r"[\s/,|()\-]+", size)
    return {_norm_size(p) for p in parts if _norm_size(p)} | {_norm_size(size)}


def size_matches(listing_size: str | None, wanted: list[str]) -> bool | None:
    """True/False if we can tell, None if the listing has no size."""
    if not listing_size or not wanted:
        return None
    have = size_tokens(listing_size)
    return any(size_tokens(w) & have for w in wanted)
