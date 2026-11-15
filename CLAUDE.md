# Rack — CLAUDE.md

Personal, self-hosted, single-user cross-marketplace fashion feed (eBay UK, Vinted UK, Grailed, Vestiaire).
Ranks listings by an explicit taste profile (wardrobe/wishlist CLIP embeddings, designers, free text, fit),
not by click history. Saved "hunts" push alerts via ntfy/Telegram/Web Push.
Full approved plan: see "Phases" below; deviations must be discussed with the user first.

## Architecture
- `backend/rack/` — Python 3.12, FastAPI, SQLAlchemy 2 async (asyncpg), Alembic, Pydantic v2 settings.
  - `api/` HTTP routes (all under `/api`, session-cookie auth except `/api/auth/*`, `/api/health`).
  - `sources/` one adapter per marketplace implementing `SourceAdapter` (`base.py`), all HTTP via
    `RateLimitedClient` (`http.py`): ≥10 s/request/source + jitter, backoff, one in flight, honest UA.
  - `parsing/` measurements/sizes/condition parsers (pure functions).
  - `embeddings/` open_clip ViT-B-32 on CPU, cached per image URL hash.
  - `ranking/` planner → filters → scoring → MMR/exploration → optional LLM.
  - `pricing/` FX (ECB via frankfurter.app), landed-cost estimate, deal score.
  - `notify/` ntfy (default), Telegram, Web Push.
  - `worker/` APScheduler process: source refresh, embeddings, hunts, price drops; polls `jobs` table.
- `frontend/` — React + Vite + TS + Tailwind PWA, TanStack Query. Built into the backend image and
  served by FastAPI at `/` (single origin).
- Postgres 16 + pgvector (512-d, HNSW). No Redis.
- Compose services: `db`, `api`, `worker`, `ntfy`, `cloudflared` (profile `tunnel`).

## Commands
On this Windows dev box uv lives at
`%LOCALAPPDATA%\Microsoft\WinGet\Packages\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe\uv.exe`
(not on PATH in agent shells; prepend it).
- Backend tests: `cd backend && uv run pytest` (`-m "not db"` skips Docker-backed tests,
  `-m "not slow"` skips the real CLIP test)
- Dev server: `cd backend && uv run uvicorn rack.api.main:app --reload` + `cd frontend && npm run dev`
  (Vite proxies `/api` to :8000; set `RACK_COOKIE_SECURE=false` for http dev)
- Demo data without eBay keys: `uv run rack load-fixture ebay tests/fixtures/ebay/search_sample.json`
- Live probe + record fixture: `uv run rack probe ebay "query" --record tests/fixtures/ebay/x.json`
- Lint/types: `cd backend && uv run ruff check . && uv run mypy rack`
- Frontend tests: `cd frontend && npm test`
- Whole stack: `docker compose up --build`
- Migrations: `cd backend && uv run alembic upgrade head`

## Conventions
- Small, typed, testable modules; parsers are pure and tested against `backend/tests/fixtures/<source>/`.
- Secrets only in `.env`; keep `.env.example` in sync.
- A broken source must never break the feed: catch in the adapter boundary, record in `source_health`.
- No proxy rotation, CAPTCHA solving, TLS-fingerprint spoofing, account logins or purchase automation.
  If a source's real behaviour differs from the plan, stop and tell the user.
- Brand is only ever a positive signal; unknown brand scores neutral (0), never negative.
- Commit at the end of each phase after tests pass.

## Phases
0. Setup  1. Skeleton (eBay, basic feed, auth)  2. Taste + ranking  3. More sources + health + dedupe
4. Hunts + notifications  5. Polish (PWA, deal score, landed cost, Web Push, README)

Status: Phase 1 code written (eBay adapter, auth, feed API, worker, frontend feed, compose).
Non-DB backend tests + Vitest pass; DB tests and `docker compose up` pending WSL/Docker on the dev box.
eBay fixture is hand-built from the documented schema — replace with a live recording once keys exist.
