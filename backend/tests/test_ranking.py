import numpy as np
import pytest

from rack.parsing.measurements import parse_measurements
from rack.profile import Measurements, Profile, Weights
from rack.ranking.brands import is_style_reference, match_designer
from rack.ranking.explain import explain
from rack.ranking.filters import Hidden, banned_keyword, hard_filter
from rack.ranking.mmr import interleave_exploration, mmr
from rack.ranking.planner import PlannerInput, all_queries, next_batch
from rack.ranking.scoring import ListingFeatures, TasteContext, score_all
from rack.ranking.vectors import as_matrix, calibrate, rocchio
from rack.sources.base import Category

D = 8


def unit(i: int, noise: float = 0.0, seed: int = 0) -> np.ndarray:
    v = np.zeros(D, dtype=np.float32)
    v[i] = 1.0
    if noise:
        v += np.random.default_rng(seed).normal(0, noise, D).astype(np.float32)
    return v / np.linalg.norm(v)


def listing(id: int, title: str = "Plain tee", price: float | None = 50.0, img=None, **kw):
    return ListingFeatures(
        id=id,
        title=title,
        description=kw.get("description"),
        brand=kw.get("brand"),
        seller=kw.get("seller"),
        price_gbp=price,
        size=kw.get("size"),
        image_embs=as_matrix([img] if img is not None else [], dim=D),
        text_emb=None,
    )


def ctx(profile: Profile | None = None, designers: dict[str, str] | None = None, **kw):
    return TasteContext(
        profile=profile or Profile(),
        designers=designers or {},
        taste_images=as_matrix([unit(0)], dim=D),
        taste_labels=["black derbies"],
        text_queries=as_matrix([], dim=D),
        text_labels=[],
        **kw,
    )


# --- brands / filters ---


def test_designer_matching() -> None:
    names = ["Maison Margiela", "Rick Owens"]
    assert match_designer("Maison Margiela", "GAT sneakers", names) == "Maison Margiela"
    assert match_designer(None, "Rick Owens geobasket", names) == "Rick Owens"
    assert match_designer(None, "Rick Owens style boots", names) is None
    assert is_style_reference("margiela style tabi", "Margiela")


def test_banned_keywords_are_whole_words() -> None:
    assert banned_keyword("Rep tabi boots", ["rep"]) == "rep"
    assert banned_keyword("Repaired boots", ["rep"]) is None
    assert banned_keyword("Maison Margiela Replica GAT", Profile().banned_keywords) is None


def _filter(**kw):
    base = dict(
        title="Jeans",
        description=None,
        brand=None,
        seller=None,
        price_gbp=50.0,
        size=None,
        category=Category.TROUSERS,
        designer=None,
        designer_weight=None,
        measurements=parse_measurements(""),
        profile=Profile(),
        hidden=Hidden(),
    )
    base.update(kw)
    return hard_filter(**base)


def test_hard_filters() -> None:
    tall = Profile(measurements=Measurements(inseam_min_cm=86))
    assert _filter() is None
    assert _filter(seller="Bad Seller", hidden=Hidden(sellers={"bad seller"})) == "hidden_seller"
    assert _filter(designer="Gucci", designer_weight="exclude") == "excluded_designer"
    assert _filter(profile=Profile(budget={"default_max_gbp": 40})) == "over_budget"
    short = parse_measurements("W32 L30")
    assert _filter(profile=tall, measurements=short) == "fit_inseam"
    # within tolerance (3 cm) passes; no measurements at all never filters
    assert _filter(profile=tall, measurements=parse_measurements("inseam 84cm")) is None
    assert _filter(profile=tall) is None


# --- scoring ---


def test_visual_similarity_ranks_lookalikes_first() -> None:
    res = {
        r.listing_id: r
        for r in score_all([listing(1, img=unit(0)), listing(2, img=unit(3))], ctx())
    }
    assert res[1].components["visual"] == 1.0
    assert res[2].components["visual"] == 0.0
    assert res[1].score > res[2].score
    assert "feedback" not in res[1].components  # no votes yet


def test_unknown_brand_is_never_penalised() -> None:
    items = [listing(1, img=unit(0)), listing(2, img=unit(0), brand="Rick Owens")]
    with_brand = score_all(items, ctx(designers={"Rick Owens": "love"}))
    no_brand_weight = score_all(
        items, ctx(Profile(weights=Weights(brand=0)), designers={"Rick Owens": "love"})
    )
    assert with_brand[0].score == no_brand_weight[0].score  # unbranded: unaffected
    assert with_brand[1].score == pytest.approx(with_brand[0].score + 0.15)


def test_deal_uses_visual_neighbour_median() -> None:
    items = [listing(i, price=100.0, img=unit(0, 0.05, seed=i)) for i in range(1, 7)]
    items.append(listing(99, price=50.0, img=unit(0, 0.05, seed=99)))
    res = {r.listing_id: r for r in score_all(items, ctx())}
    assert res[99].components["deal"] == pytest.approx(0.75)
    assert res[99].details["median_gbp"] == 100.0
    assert res[1].components["deal"] < 0.6


def test_deal_is_neutral_without_enough_neighbours() -> None:
    res = score_all([listing(1, img=unit(0)), listing(2, img=unit(0))], ctx())
    assert res[0].components["deal"] == 0.5


def test_style_listing_is_penalised() -> None:
    c = ctx(designers={"Margiela": "love"})
    a, b = score_all(
        [
            listing(1, "Margiela style tabi boots", img=unit(0)),
            listing(2, "Tabi boots", img=unit(0)),
        ],
        c,
    )
    assert a.components["knockoff"] == 1.0
    assert a.score == pytest.approx(b.score - 0.5)


def test_maximum_top_length() -> None:
    p = Profile(measurements=Measurements(length_min_cm=72, length_max_cm=80))
    top = dict(category=Category.TOPS, profile=p)
    assert _filter(**top, measurements=parse_measurements("length 76cm")) is None
    assert _filter(**top, measurements=parse_measurements("length 82cm")) is None  # within 3 cm
    assert _filter(**top, measurements=parse_measurements("length 85cm")) == "fit_length"
    assert _filter(**top, measurements=parse_measurements("length 66cm")) == "fit_length"
    # trousers have no top length; no measurement never filters
    assert (
        _filter(
            category=Category.TROUSERS, profile=p, measurements=parse_measurements("length 95cm")
        )
        is None
    )
    assert _filter(**top) is None


def test_fit_rewards_long_inseam() -> None:
    p = Profile(measurements=Measurements(inseam_min_cm=86))
    good, short = score_all(
        [listing(1, "Jeans W32 L36", img=unit(0)), listing(2, "Jeans inseam 84cm", img=unit(0))],
        ctx(p),
    )
    assert good.components["fit"] == 1.0
    assert 0 < short.components["fit"] < 1
    assert good.filtered_reason is None and short.filtered_reason is None


def test_feedback_component_appears_with_votes() -> None:
    pref = rocchio(unit(0), as_matrix([unit(1)], dim=D), as_matrix([], dim=D))
    res = score_all([listing(1, img=unit(1))], ctx(pref=pref))
    assert "feedback" in res[0].components


def test_calibrate_and_rocchio() -> None:
    assert calibrate(0.55, 0.55, 0.9) == 0.0
    assert calibrate(1.0, 0.55, 0.9) == 1.0
    assert rocchio(None, as_matrix([], dim=D), as_matrix([], dim=D)) is None


# --- explain / mmr / planner ---


def test_explain_picks_strongest_reasons() -> None:
    text = explain(
        {"visual": 0.8, "brand": 1.0, "deal": 0.75, "fit": 0.5, "knockoff": 0.0},
        {
            "visual_label": "black derbies",
            "designer": "Rick Owens",
            "designer_weight": "love",
            "median_gbp": 200.0,
        },
        Weights(),
    )
    assert (
        text
        == "Looks like your black derbies · Rick Owens (love) · ~50% under similar listings (median £200)"
    )
    assert explain({"fit": 0.5}, {}, Weights()) == "New in your categories"


def test_mmr_promotes_variety() -> None:
    embs = as_matrix([unit(0), unit(0), unit(1)], dim=D)
    assert mmr([1.0, 0.99, 0.9], embs, lam=0.7) == [0, 2, 1]


def test_exploration_interleave() -> None:
    ranked = list(range(12))
    out = interleave_exploration(ranked, [100, 101], rate=0.25, seed=1)
    assert out[3] in (100, 101) and out[7] in (100, 101)
    assert sorted(out) == sorted(ranked + [100, 101])
    assert out == interleave_exploration(ranked, [100, 101], rate=0.25, seed=1)
    assert interleave_exploration(ranked, [100], rate=0, seed=1) == ranked


def test_planner_rotation() -> None:
    p = Profile(categories=[Category.TOPS, Category.TROUSERS])
    qs = all_queries(
        PlannerInput(
            p,
            {"Rick Owens": "love", "Lemaire": "like", "Gucci": "exclude"},
            {"Rick Owens": ["Julius", "Lemaire", "Gucci"]},
            ["black derby"],
        )
    )
    assert [(q.text, q.category) for q in qs] == [
        ("Rick Owens", Category.TOPS),
        ("Rick Owens", Category.TROUSERS),
        ("black derby", Category.ANY),
        ("Julius", Category.ANY),
        ("Lemaire", Category.ANY),
    ]
    batch, cursor = next_batch(qs, 3, 3)
    assert [q.text for q in batch] == ["Julius", "Lemaire", "Rick Owens"]
    assert cursor == 1
