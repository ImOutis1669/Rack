"""Taste profile schema (stored as JSON in the single `profile` row)."""

from pydantic import BaseModel, Field

from rack.sources.base import Category

DESIGNER_WEIGHTS = ("love", "like", "curious", "exclude")
BRAND_AFFINITY = {"love": 1.0, "like": 0.6, "curious": 0.3}


class Weights(BaseModel):
    visual: float = 0.40
    text: float = 0.10
    brand: float = 0.15
    feedback: float = 0.15
    deal: float = 0.10
    fit: float = 0.10
    knockoff_penalty: float = 0.50


class Measurements(BaseModel):
    """Your minimums/limits in cm. None = don't care."""

    inseam_min_cm: float | None = None
    sleeve_min_cm: float | None = None
    p2p_min_cm: float | None = None
    p2p_max_cm: float | None = None
    length_min_cm: float | None = None
    tolerance_cm: float = 3.0  # shortfall beyond this hard-filters the listing


class Budget(BaseModel):
    default_max_gbp: float | None = None
    per_category: dict[Category, float] = Field(default_factory=dict)

    def max_for(self, category: Category) -> float | None:
        return self.per_category.get(category, self.default_max_gbp)


class Profile(BaseModel):
    context: str = ""
    # Not "replica": Maison Margiela sells a genuine "Replica" line (GATs, etc.).
    banned_keywords: list[str] = Field(
        default_factory=lambda: ["dupe", "fake", "inspired", "rep", "1:1", "unauthorized"]
    )
    sizes: dict[Category, list[str]] = Field(default_factory=dict)
    strict_size: bool = False
    measurements: Measurements = Field(default_factory=Measurements)
    budget: Budget = Field(default_factory=Budget)
    weights: Weights = Field(default_factory=Weights)
    exploration: float = Field(default=0.15, ge=0.0, le=0.30)
    categories: list[Category] = Field(
        default_factory=lambda: [
            Category.TOPS,
            Category.TROUSERS,
            Category.SHOES,
            Category.OUTERWEAR,
        ]
    )
