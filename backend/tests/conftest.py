from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

BACKEND = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def pg_url() -> Iterator[str]:
    """Throwaway pgvector Postgres, migrated to head. Requires Docker."""
    from alembic import command
    from alembic.config import Config

    try:
        from testcontainers.community.postgres import PostgresContainer
    except ImportError:
        from testcontainers.postgres import PostgresContainer

    with PostgresContainer("pgvector/pgvector:pg16", driver="asyncpg") as pg:
        url = pg.get_connection_url()
        cfg = Config(str(BACKEND / "alembic.ini"))
        cfg.set_main_option("script_location", str(BACKEND / "alembic"))
        cfg.set_main_option("sqlalchemy.url", url)
        command.upgrade(cfg, "head")
        yield url


@pytest.fixture
async def sessions(pg_url: str) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine(pg_url)
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE listings, listing_images, source_health CASCADE"))
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()
