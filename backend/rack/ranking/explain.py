"""Templated "Why this?" text from score components. Always available (no LLM needed)."""

from typing import Any

from rack.profile import Weights

FIT_NAMES = {"inseam": "Inseam", "sleeve": "Sleeve", "p2p": "Pit-to-pit", "length": "Length"}


def _reason(key: str, value: float, d: dict[str, Any]) -> str | None:
    if key == "visual" and value >= 0.35:
        label = d.get("visual_label") or "wardrobe"
        return f"Looks like your {label}"
    if key == "text" and value >= 0.35:
        label = d.get("text_label")
        return f"Matches “{label}”" if label else "Matches your description"
    if key == "brand" and value > 0 and d.get("designer"):
        return f"{d['designer']} ({d.get('designer_weight')})"
    if key == "feedback" and value >= 0.5:
        return "Similar to things you 👍"
    if key == "deal" and value >= 0.6 and d.get("median_gbp"):
        pct = round((value - 0.5) * 200)
        return f"~{pct}% under similar listings (median £{d['median_gbp']:.0f})"
    if key == "fit" and value >= 0.75:
        gaps = d.get("fit_gaps") or {}
        ok = [FIT_NAMES[k] for k, g in gaps.items() if g <= 0]
        if ok:
            return f"{' & '.join(ok)} long enough for you"
        return "Your size"
    return None


def explain(components: dict[str, float], details: dict[str, Any], weights: Weights) -> str:
    """Up to three reasons, strongest weighted contribution first."""
    w = weights.model_dump()
    ranked = sorted(
        (k for k in components if k != "knockoff"),
        key=lambda k: w.get(k, 0.0) * components[k],
        reverse=True,
    )
    parts = [r for k in ranked if (r := _reason(k, components[k], details))][:3]
    if components.get("knockoff"):
        parts.append(f"⚠ possible knock-off: {details.get('knockoff', '')}".rstrip(": "))
    return " · ".join(parts) if parts else "New in your categories"
