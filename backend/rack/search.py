"""Search across all sources (v2.1 step 4b): the text-match expressions and query cleaning.

The two SQL expressions must stay exactly as in migration 0021, or Postgres won't use the
indexes. They're written as literal SQL (not SQLAlchemy expressions) so no bound parameters
end up inside them.
"""

import re

from sqlalchemy import ColumnElement, Float, func, literal_column, or_
from sqlalchemy.sql.elements import ColumnClause

TRGM_DOC: ColumnClause[str] = literal_column(
    "lower(coalesce(listings.brand, '') || ' ' || listings.title)"
)
FTS_DOC: ColumnClause[object] = literal_column(
    "to_tsvector('simple'::regconfig, coalesce(listings.brand, '') || ' ' || listings.title"
    " || ' ' || coalesce(listings.description, ''))"
)
# word_similarity(query, doc) at or above this counts as a match ("geobaskt" ~ "geobasket")
WORD_SIMILARITY = 0.45
MIN_QUERY = 2
MAX_QUERY = 100


def clean_query(raw: str) -> str:
    """Lowercase, collapse whitespace, drop control characters; '' if too short."""
    q = " ".join("".join(ch for ch in raw if ch.isprintable()).split()).lower()[:MAX_QUERY]
    return q if len(re.sub(r"\W", "", q)) >= MIN_QUERY else ""


def tsquery(q: str) -> ColumnElement[object]:
    return func.websearch_to_tsquery(literal_column("'simple'::regconfig"), q)


def matches(q: str) -> ColumnElement[bool]:
    """Every word found (full text), or close enough to the brand + title (trigram)."""
    return or_(FTS_DOC.op("@@")(tsquery(q)), TRGM_DOC.op("%>")(q))


def relevance(q: str) -> ColumnElement[float]:
    """Full-text rank (weighted up: all words present) plus trigram closeness."""
    return func.ts_rank(FTS_DOC, tsquery(q), type_=Float) * 2 + func.word_similarity(
        q, TRGM_DOC, type_=Float
    )
