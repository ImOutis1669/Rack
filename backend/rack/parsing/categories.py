"""Infer a listing's category and match sizes, from title text."""

import re

from rack.sources.base import Category

# Order matters: outerwear before tops ("shirt jacket"), shoes before trousers ("boot cut" is
# rare), accessories last, so a garment that mentions one ("belted coat", "cap sleeve tee") stays
# a garment.
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
            "raincoat",
            "topcoat",
            "trenchcoat",
            "car coat",
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
            "hoody",
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
    (
        Category.ACCESSORIES,
        (
            "necklace",
            "pendant",
            "chain",
            "ring",
            "bracelet",
            "bangle",
            "earring",
            "cufflink",
            "jewellery",
            "jewelry",
            "watch",
            "hat",
            "cap",
            "beanie",
            "balaclava",
            "bandana",
            "scarf",
            "scarves",
            "glove",
            "mitten",
            "belt",
            "bag",
            "backpack",
            "tote",
            "holdall",
            "wallet",
            "cardholder",
            "card holder",
            "sunglasses",
            "eyewear",
            "tie",
            "bow tie",
            "keychain",
            "keyring",
            "key ring",
            "lanyard",
            "braces",
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
    tokens = {_norm_size(p) for p in parts if _norm_size(p)} | {_norm_size(size)}
    # waist: "W32" / "W32 L34" also match a plain "32"
    tokens |= {m.group(1) for t in tokens if (m := re.fullmatch(r"w(\d{2})", t))}
    return tokens


# Men's shoe sizes across systems, Rick Owens / Margiela / Converse convention: EU = UK + 34
# (UK 9 = EU 43), US = UK + 1. Brands differ by up to half a size, so UK/US vs EU readings match
# within 0.5; readings in the same family must be equal (UK 9 is not UK 9.5).
_SHOE_PREFIXED = re.compile(r"\b(uk|eu|us)\s?(\d{1,2}(?:\.5)?)\b", re.I)
_SHOE_BARE = re.compile(r"(?<![a-z0-9.])(\d{1,2}(?:\.5)?)(?![0-9.])", re.I)
ShoeReading = tuple[str, float]  # (family "uk" | "eu", size as EU)


def shoe_sizes(size: str) -> set[ShoeReading]:
    """Shoe readings in a size string, as EU sizes. Bare 3-15 reads as UK, 35-50 as EU."""
    out: set[ShoeReading] = set()
    for system, value in _SHOE_PREFIXED.findall(size):
        n = float(value)
        if system.lower() == "eu" and 35 <= n <= 50:
            out.add(("eu", n))
        elif system.lower() == "uk" and 3 <= n <= 15:
            out.add(("uk", n + 34))
        elif system.lower() == "us" and 4 <= n <= 16:
            out.add(("uk", n + 33))
    rest = _SHOE_PREFIXED.sub(" ", size)
    for value in _SHOE_BARE.findall(rest):
        n = float(value)
        if 35 <= n <= 50:
            out.add(("eu", n))
        elif 3 <= n <= 15:
            out.add(("uk", n + 34))
    return out


def _shoes_match(a: set[ShoeReading], b: set[ShoeReading]) -> bool:
    for fa, va in a:
        for fb, vb in b:
            if va == vb or (fa != fb and abs(va - vb) <= 0.5):
                return True
    return False


_LETTER = r"(?:xxxs|xxs|xs|s|m|l|xl|xxl|xxxl|[2-4]xl)"
_NUM = r"\d{1,2}(?:\.5)?"
TITLE_SIZE_PATTERNS = [
    # "UK 9", "EU42", "US 9.5", "IT 48": keep the system so size normalisation can compare
    re.compile(rf"\b(?:uk|eu|us|it|fr|jp)\s?{_NUM}\b", re.I),
    re.compile(r"\bw\s?\d{2}(?:\s?l\s?\d{2})?\b", re.I),  # W32, W32 L34
    re.compile(rf"\bsize[:\s]+(?:{_LETTER}|{_NUM})\b", re.I),
    re.compile(rf"\bsz[:\s]*(?:{_LETTER}|{_NUM})\b", re.I),
]


def size_from_title(title: str) -> str | None:
    """Best-effort size from a listing title, for sources whose search results have no size."""
    for pattern in TITLE_SIZE_PATTERNS:
        if m := pattern.search(title):
            return re.sub(r"^(?:size|sz)[:\s]*", "", m.group(0), flags=re.I).strip()
    return None


def size_matches(listing_size: str | None, wanted: list[str]) -> bool | None:
    """True/False if we can tell, None if the listing has no size."""
    if not listing_size or not wanted:
        return None
    have = size_tokens(listing_size)
    if any(size_tokens(w) & have for w in wanted):
        return True
    shoes = shoe_sizes(listing_size)
    return bool(shoes) and any(_shoes_match(shoes, shoe_sizes(w)) for w in wanted)
