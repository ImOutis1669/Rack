"""Grailed sizes: US shoe sizes read as US, and "size must match" sent to Grailed's search."""

from rack.parsing.categories import size_matches
from rack.profile import Profile
from rack.ranking.planner import PlannerInput, tailored_streams
from rack.sources import grailed
from rack.sources.base import Category, SearchQuery


def test_grailed_shoe_sizes_are_us() -> None:
    assert grailed.us_shoe_size("footwear", 14) == "US 14"
    assert grailed.us_shoe_size("footwear", "8.5") == "US 8.5"
    assert grailed.us_shoe_size("footwear", "one size") == "one size"
    assert grailed.us_shoe_size("bottoms", 32) == "32"
    assert grailed.us_shoe_size("tops", None) is None
    # UK 13 is a US 14, not a US 13 (the bug: a bare "13" was read as UK 13)
    assert size_matches("US 14", ["UK 13"]) is True
    assert size_matches("US 13", ["UK 13"]) is False


def test_recorded_footwear_hits_get_us_sizes() -> None:
    from tests.test_sources_phase3 import GRAILED_JSON

    hits = {str(h["id"]): h for h in GRAILED_JSON["hits"]}
    for item in grailed.parse_results(GRAILED_JSON):
        hit = hits[item.source_id]
        if (
            hit.get("category") == "footwear"
            and str(hit.get("size", "")).replace(".", "").isdigit()
        ):
            assert item.size == f"US {hit['size']}"


def test_size_values() -> None:
    assert grailed.size_values(Category.SHOES, ["UK 13"]) == ["category_size:footwear.14"]
    assert grailed.size_values(Category.SHOES, ["EU 43"]) == [
        "category_size:footwear.9.5",
        "category_size:footwear.10",
        "category_size:footwear.10.5",
    ]
    assert grailed.size_values(Category.TROUSERS, ["33", "W34 L32"]) == [
        "category_size:bottoms.33",
        "category_size:bottoms.34",
    ]
    assert grailed.size_values(Category.TOPS, ["M", "XXL", "2XL"]) == [
        "category_size:tops.m",
        "category_size:tops.xxl",
    ]
    # anything we can't name exactly: no restriction at all, never a guess
    assert grailed.size_values(Category.TOPS, ["M", "48"]) is None
    assert grailed.size_values(Category.TROUSERS, ["M"]) is None
    assert grailed.size_values(Category.ACCESSORIES, ["M"]) is None
    assert grailed.size_values(Category.SHOES, []) is None


def test_body_with_sizes() -> None:
    sizes = {Category.SHOES: ["UK 13"], Category.TROUSERS: ["33"]}
    shoes = grailed.build_body(SearchQuery(text="rick", category=Category.SHOES, sizes=sizes))
    assert shoes["facetFilters"] == [["department:menswear"], ["category_size:footwear.14"]]
    coats = grailed.build_body(SearchQuery(text="rick", category=Category.OUTERWEAR, sizes=sizes))
    assert coats["facetFilters"][1] == ["category:outerwear", "category:tailoring"]  # no sizes
    anything = grailed.build_body(SearchQuery(text="rick", sizes=sizes))
    assert anything["facetFilters"][1] == [  # every category, sized where we know the size
        "category:tops",
        "category_size:bottoms.33",
        "category_size:footwear.14",
        "category:outerwear",
        "category:tailoring",
        "category:accessories",
    ]
    plain = grailed.build_body(SearchQuery(text="rick"))
    assert plain["facetFilters"] == [["department:menswear"]]


def test_planner_sends_sizes_only_when_size_must_match() -> None:
    sizes = {Category.SHOES: ["UK 13"]}
    strict = Profile(sizes=sizes, strict_size=True)
    loose = Profile(sizes=sizes, strict_size=False)
    for profile, want in ((strict, sizes), (loose, {})):
        streams = tailored_streams(PlannerInput(profile, {"Rick Owens": "love"}, {}, ["tabi"]))
        assert all(q.sizes == want for s in streams.values() for q in s)
