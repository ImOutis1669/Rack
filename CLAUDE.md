# Rack — CLAUDE.md

Personal, self-hosted, single-user cross-marketplace fashion feed (eBay UK, Vinted UK, Grailed, Vestiaire).
Host: the user's Windows gaming PC (Ryzen 5 7600X, 32 GB, RTX 4070 Super) via Docker Desktop, not an N100.
Ranks listings by an explicit taste profile (wardrobe/wishlist CLIP embeddings, designers, free text, fit),
not by click history. Saved "hunts" push alerts via ntfy/Telegram/Web Push.
Full approved plan: see "Phases" below; deviations must be discussed with the user first.

## Architecture
- `backend/rack/` — Python 3.12, FastAPI, SQLAlchemy 2 async (asyncpg), Alembic, Pydantic v2 settings.
  - `api/` HTTP routes (all under `/api`, session-cookie auth except `/api/auth/*`, `/api/health`).
  - `sources/` one adapter per marketplace implementing `SourceAdapter` (`base.py`), all HTTP via
    `RateLimitedClient` (`http.py`): ≥10 s/request/source + jitter, backoff, one in flight, honest UA.
  - `parsing/` measurements/sizes/condition parsers (pure functions).
  - `embeddings/` open_clip ViT-B-32 on CPU (worker only; API never imports torch), cached per image URL
    hash. `images.py` sanitises uploads (EXIF stripped, re-encoded JPEG) and guards pasted URLs (SSRF).
  - `ranking/` planner → filters → scoring → explain; MMR/exploration applied at request time in
    `api/feed.py` (sort=best). Optional LLM re-rank deferred to Phase 5.
  - `profile.py` taste profile schema (JSON in the single `profile` row); `store.py` profile/app_state
    helpers. Anything that changes ranking calls `bump_version()`; the worker rescores when the
    version, embeddings or listings change (`app_state['scoring']`).
  - `pricing/` FX (ECB via frankfurter.app), landed-cost estimate, deal score.
  - `notify/` ntfy (default), Telegram, Web Push.
  - `worker/` APScheduler process: source refresh (planner-driven, rotating cursor in
    `app_state['planner']`), embed+score every 60 s; later hunts and price drops.
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
- CLI: use `uv run python -m rack.cli …` on this PC (Windows Application Control blocks the
  generated `rack.exe`); inside Docker `rack …` works.
- Demo data: `python -m rack.cli load-fixture {ebay|vinted|grailed} <fixture>`
- Live probe + record fixture: `python -m rack.cli probe vinted "query" --record tests/fixtures/vinted/x.html`
  (Vinted fixtures are trimmed to the result objects; Grailed drops `_highlightResult`)
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
- APScheduler 3 needs a real coroutine function (bound `async def` method), not an object with async
  `__call__` — the latter is silently never awaited.
- Scoring constants (cosine calibration bands, neighbour thresholds) live at the top of
  `ranking/scoring.py`. They are educated guesses for CLIP ViT-B-32 and need tuning on real listings.
- No "replica" in default banned words: Maison Margiela sells a genuine "Replica" line.
- Sources (checked live 2026-11-15, see module docstrings):
  - eBay: official Browse API (no keys yet).
  - Vinted: `/api/v2/catalog/items` is gone (404); parse `productItem` objects from the Next.js
    flight data of `/catalog?search_text=…`, men's catalogue ids from the page's own tree.
    price_gbp includes the compulsory buyer-protection fee. DataDome is present.
  - Grailed: grailed.com is Cloudflare-blocked (also for headless Chromium). User chose to query
    Grailed's Algolia index directly with the public search-only key (in .env), honest UA, no browser
    impersonation headers. Index has no descriptions; hits that don't ship to the UK are dropped.
  - Vestiaire: Cloudflare Turnstile. Stub only; `sources/recheck.py` checks once a day.
  - Boundaries agreed with the user: no CAPTCHA solving, stealth/fingerprint spoofing, browser UA
    impersonation or proxies, even though they're fine with "whatever it takes".
- Dedupe (`ranking/dedupe.py`): pHash ≤ 6 bits AND CLIP ≥ 0.96 AND compatible brands (checked per
  group) AND title-word overlap ≥ 0.2; hashes shared by > 5 listings are placeholders. Known miss:
  near-identical photos + titles of genuinely different items (e.g. two lookbooks) still merge.
- The worker stores the last refresh time; restarts don't re-run searches early.

## Phases
0. Setup  1. Skeleton (eBay, basic feed, auth)  2. Taste + ranking  3. More sources + health + dedupe
4. Hunts + notifications  5. Polish (PWA, deal score, landed cost, Web Push, README)

Status: Phase 3 done (Vinted + Grailed live, Vestiaire blocked stub, health panel, dedupe).
73 backend tests (+1 slow) + 10 Vitest pass. Phase 2 notes: 57 backend (+1 slow real-CLIP) + 10 Vitest tests pass; compose stack verified
locally (CLIP weights download to `/data/hf` on first worker run, ~2 min).
eBay fixture is hand-built from the documented schema; its image URLs resolve to eBay's grey placeholder,
so visual matches on fixture data are meaningless. Replace with a live recording once keys exist.
Local `.env` is dev-only (RACK_COOKIE_SECURE=false; dev password in its first-line comment).
Next: Phase 4 (hunts + notifications). Price drops need item-page parsing for Vinted (Grailed item
pages are blocked; could re-query the Algolia index by objectID instead).
