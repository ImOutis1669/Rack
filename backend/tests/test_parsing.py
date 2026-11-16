import pytest

from rack.parsing.categories import infer_category, size_from_title, size_matches
from rack.parsing.measurements import parse_measurements
from rack.sources.base import Category


def test_cm_measurements() -> None:
    m = parse_measurements("Pit to pit: 60cm, sleeve length 68 cm, length 76cm")
    assert (m.p2p_cm, m.sleeve_cm, m.length_cm) == (60, 68, 76)


def test_inch_measurements_with_and_without_units() -> None:
    m = parse_measurements('p2p 23" / inseam 34')
    assert m.p2p_cm == pytest.approx(58.4)
    assert m.inseam_cm == pytest.approx(86.4)


def test_unitless_large_value_is_cm() -> None:
    assert parse_measurements("Length 74").length_cm == 74


def test_waist_leg_formats() -> None:
    m = parse_measurements("Selvedge jeans W32 L34")
    assert m.waist_in == 32 and m.inseam_cm == pytest.approx(86.4)
    assert parse_measurements("size 32x36 straight").inseam_cm == pytest.approx(91.4)


def test_explicit_inseam_beats_leg_size() -> None:
    assert parse_measurements("W32 L32, inseam 88cm").inseam_cm == 88


def test_implausible_values_are_dropped() -> None:
    assert parse_measurements("sleeve 12cm").sleeve_cm is None
    assert parse_measurements(None).as_dict() == {}


@pytest.mark.parametrize(
    ("title", "cat"),
    [
        ("Rick Owens leather jacket", Category.OUTERWEAR),
        ("Our Legacy shirt jacket", Category.OUTERWEAR),
        ("Margiela tabi boots", Category.SHOES),
        ("Our Legacy third cut jeans", Category.TROUSERS),
        ("Lemaire twisted shirt", Category.TOPS),
        ("Margiela 5AC bag", Category.ANY),
    ],
)
def test_infer_category(title: str, cat: Category) -> None:
    assert infer_category(title) == cat


def test_size_matches() -> None:
    assert size_matches("M", ["M"]) is True
    assert size_matches("UK 10 / EU 44", ["10"]) is True
    assert size_matches("XXL", ["2XL"]) is True
    assert size_matches("S", ["L", "XL"]) is False
    assert size_matches(None, ["M"]) is None


def test_size_from_title() -> None:
    cases = {
        "MAISON MARGIELA S57WS0257 Sneakers EU42 US9 Black": "EU42",
        "Rick Owens Tee Black Size L": "L",
        "Levis 501 W32 L34": "W32 L34",
        "Raf Simons hoodie sz XL": "XL",
        "Geobasket boots UK 9.5": "UK 9.5",
        "Jacket size 48 IT": "48",
        "Prada nylon bag": None,
        "Mask Usage tee": None,  # 'us' inside a word is not a size
    }
    for title, size in cases.items():
        assert size_from_title(title) == size, title
    # what it finds still compares with the existing size normalisation
    assert size_matches(size_from_title("Boots UK 9"), ["9"]) is True
