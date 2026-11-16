"""Static delivery: gzip for text, long caching for hashed assets, no-cache for the app shell."""

from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from rack.api.main import create_app


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index-abc123.js").write_text("console.log('rack');\n" * 400)
    (tmp_path / "index.html").write_text("<!doctype html><title>Rack</title>" + " " * 2000)
    (tmp_path / "sw.js").write_text("self.addEventListener('fetch', () => {});\n" * 50)
    return create_app(static_dir=tmp_path)


async def test_assets_are_gzipped_and_cached_for_good(app: FastAPI) -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/assets/index-abc123.js", headers={"Accept-Encoding": "gzip"})
        assert r.status_code == 200
        assert r.headers["content-encoding"] == "gzip"
        assert int(r.headers["content-length"]) < 1000  # 8.4 kB of text compresses to far less
        assert r.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert r.text.startswith("console.log")  # httpx decompresses it again

        shell = await c.get("/", headers={"Accept-Encoding": "gzip"})
        assert shell.headers["cache-control"] == "no-cache"
        assert shell.headers["content-encoding"] == "gzip"
        deep = await c.get("/taste")  # client-side routes get the shell too
        assert deep.headers["cache-control"] == "no-cache"
        sw = await c.get("/sw.js")
        assert sw.headers["cache-control"] == "no-cache"


async def test_security_headers_survive_compression(app: FastAPI) -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/", headers={"Accept-Encoding": "gzip"})
        assert "default-src 'self'" in r.headers["content-security-policy"]
        assert r.headers["x-frame-options"] == "DENY"
