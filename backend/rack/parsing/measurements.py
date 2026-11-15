"""Parse garment measurements from free listing text. All outputs are in centimetres.

Sellers write e.g. "p2p 60cm", "pit to pit: 23\"", "inseam 34in", "W32 L34", "32x34",
"sleeve 66 cm", "length 74". Values without a unit are disambiguated by plausible ranges.
"""

import re
from dataclasses import asdict, dataclass

INCH = 2.54
NUM = r"(\d{2}(?:[.,]\d)?)"
UNIT = r"\s*(cm|centimet(?:er|re)s?|in(?:ch(?:es)?)?\b|\"|''|”)?"
SEP = r"\s*(?:[:=\-–]|is|of)?\s*"

PATTERNS: dict[str, list[str]] = {
    "p2p_cm": [
        r"\bp\s?2\s?p",
        r"\bpit[\s\-]*to[\s\-]*pit",
        r"\barmpit[\s\-]*to[\s\-]*armpit",
        r"\bchest",
    ],
    "inseam_cm": [
        r"\binseam",
        r"\binside\s+leg",
        r"\binner\s+leg",
        r"\binner\s+seam",
        r"\bleg\s+length",
    ],
    "sleeve_cm": [r"\bsleeves?(?:\s+length)?", r"\barm\s+length"],
    "length_cm": [
        r"(?<!sleeve )(?<!arm )(?<!leg )\b(?:back\s+|total\s+|body\s+)?length",
        r"\bcollar\s+to\s+hem",
        r"\bpit\s+to\s+hem",
    ],
}

# (max value that is treated as inches when no unit given)
INCH_CEILING = {"p2p_cm": 35, "inseam_cm": 45, "sleeve_cm": 45, "length_cm": 45}
# plausible cm ranges; outside -> discard
PLAUSIBLE_CM = {
    "p2p_cm": (35, 90),
    "inseam_cm": (50, 110),
    "sleeve_cm": (40, 110),
    "length_cm": (40, 130),
}

W_L_RE = re.compile(r"\bW\s?(\d{2})\s*(?:[xX/]|\s)\s*L\s?(\d{2})\b")
X_RE = re.compile(r"\b(2[6-9]|3\d|40)\s?[xX]\s?(2[6-9]|3\d|40)\b")


@dataclass
class ParsedMeasurements:
    p2p_cm: float | None = None
    inseam_cm: float | None = None
    sleeve_cm: float | None = None
    length_cm: float | None = None
    waist_in: float | None = None

    def as_dict(self) -> dict[str, float]:
        return {k: v for k, v in asdict(self).items() if v is not None}


def _to_cm(field: str, value: float, unit: str | None) -> float | None:
    if unit:
        u = unit.lower()
        cm = value if u.startswith("c") else value * INCH
    else:
        cm = value * INCH if value <= INCH_CEILING[field] else value
    lo, hi = PLAUSIBLE_CM[field]
    return round(cm, 1) if lo <= cm <= hi else None


def parse_measurements(text: str | None) -> ParsedMeasurements:
    out = ParsedMeasurements()
    if not text:
        return out
    t = text.replace(" ", " ")

    for field, labels in PATTERNS.items():
        for label in labels:
            m = re.search(label + SEP + NUM + UNIT, t, flags=re.IGNORECASE)
            if not m:
                continue
            value = float(m.group(1).replace(",", "."))
            cm = _to_cm(field, value, m.group(2))
            if cm is not None:
                setattr(out, field, cm)
                break

    wl = W_L_RE.search(t) or X_RE.search(t)
    if wl:
        out.waist_in = float(wl.group(1))
        if out.inseam_cm is None:
            out.inseam_cm = round(float(wl.group(2)) * INCH, 1)
    return out
