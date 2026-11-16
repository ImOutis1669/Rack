from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import httpx
import pytest
from fastapi import Depends
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
        await conn.execute(
            text(
                "TRUNCATE listings, listing_images, source_health, profile, designers, "
                "adjacent_designers, taste_items, hidden, app_state, hunts, notifications, "
                "push_subscriptions CASCADE"
            )
        )
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


PASSWORD = "a-very-long-test-password"
_HASH: str | None = None


def password_hash() -> str:
    global _HASH
    if _HASH is None:
        from rack.api.auth import hash_password

        _HASH = hash_password(PASSWORD)
    return _HASH


@pytest.fixture
async def client(
    sessions: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    pg_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[httpx.AsyncClient]:
    from rack.api.auth import attempts, require_session, reset_caches
    from rack.api.main import create_app
    from rack.config import get_settings
    from rack.db import get_session, init_engine

    test_env = {
        "RACK_PASSWORD_HASH": password_hash(),
        "RACK_SESSION_SECRET": "test-secret-that-is-long-enough-1234567890",
        "RACK_TRUSTED_PROXIES": "",
        "RACK_COOKIE_SECURE": "false",
        "RACK_DATA_DIR": str(tmp_path / "data"),
        "DATABASE_URL": pg_url,
    }
    # FastAPI caches how shared module-level routers resolve dependencies, so a dependency
    # override can occasionally be skipped across test apps. Make the real settings and the
    # default database match the test ones too, so the result is the same either way.
    for k, v in test_env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    init_engine(pg_url)
    settings = get_settings()
    app = create_app(static_dir=tmp_path)

    @app.post("/api/_test/mutate", dependencies=[Depends(require_session)])
    def _mutate() -> dict[str, bool]:
        return {"ok": True}

    # The SPA catch-all was registered first; move our test route ahead of it.
    app.router.routes.insert(0, app.router.routes.pop())

    async def _session() -> AsyncIterator[AsyncSession]:
        async with sessions() as s:
            yield s

    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_session] = _session
    attempts.clear()
    reset_caches()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    get_settings.cache_clear()  # env is restored by monkeypatch; don't keep test settings cached


async def login(client: httpx.AsyncClient) -> None:
    r = await client.post("/api/auth/login", json={"password": PASSWORD})
    assert r.status_code == 204, r.text
