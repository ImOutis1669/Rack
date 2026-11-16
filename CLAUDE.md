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
- Dependency audit: `sh scripts/audit.sh`
- Frontend tests: `cd frontend && npm test`
- Whole stack: `docker compose up --build`
- Migrations: `cd backend && uv run alembic upgrade head`

## Frontend design
`DESIGN.md` is the UI source of truth (tokens, type, navigation, Magic UI usage). Shared pieces:
`components/ui` (buttons, sheet, grouped rows, switch), `components/AppShell` (glass top bar, iPhone
tab bar), `components/magicui/*` (adapted Magic UI, MIT), `lucide-react` icons only. Use `cn()` from
`lib/utils` (tailwind-merge knows the custom text sizes and radii). SF Pro comes from the system font
stack; never bundle Apple font files.

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
  - eBay: official Browse API. Production keys are in `.env.worker` (never print them).
    **No eBay user data is stored** (user's Marketplace Account Deletion exemption: "I do not persist
    eBay data"): the adapter never parses the seller or item city/postcode, `raw` is an allow-list
    (`ebay.RAW_KEYS`, so recorded fixtures are clean too), `privacy.scrub` re-checks at ingest, and
    the hourly `ebay_retention` worker job deletes eBay listings that are inactive or unseen for
    `RACK_EBAY_RETENTION_DAYS` (7; votes/saves on them go too). "Hide seller" is disabled for eBay.
    Live behaviour (probed 2026-11-16): quota 5,000 searches + 5,000 item lookups per eBay day
    (resets 08:00 UTC). Search summaries have no size/brand/department, so the worker's
    `ebay_details` job looks each new listing up once with getItem (`RACK_EBAY_DETAILS_DAILY_CAP`
    1000, 20 per 2-min run); until then size comes from the title (`parsing.size_from_title`).
    Searches add `deliveryCountry:GB` (imports allowed; most archive stock is JP/US). Women's items
    are skipped (category names / getItem Department); getItem-detected ones get
    `listings.excluded='womens'` so searches don't reactivate them. Daily call counts live in
    `app_state['ebay_usage']` and show in the Sources sheet. Fixtures are made-up values in the
    real shape: never commit real eBay responses.
  - Vinted: `/api/v2/catalog/items` is gone (404); parse `productItem` objects from the Next.js
    flight data of `/catalog?search_text=…`, men's catalogue ids from the page's own tree.
    price_gbp includes the compulsory buyer-protection fee. DataDome is present.
  - Grailed: grailed.com is Cloudflare-blocked (also for headless Chromium). User chose to query
    Grailed's Algolia index directly with the public search-only key (in .env), honest UA, no browser
    impersonation headers. Index has no descriptions; hits that don't ship to the UK are dropped.
  - Vestiaire: Cloudflare Turnstile (also blocks the user's residential connection). User chose the
    paid Apify actor `b2b_leads/vestiaire-collective-real-time-data-scraper` (Apify's UK residential
    proxies) via `sources/vestiaire.py`; runs only in its own daily job with per-run and monthly
    result caps (`vestiaire_*` settings, usage in `app_state['vestiaire_usage']`). Without
    APIFY_TOKEN, `sources/recheck.py` checks the site daily. Fixture is hand-built from the actor's
    docs until a live run is recorded.
  - Rack itself does no CAPTCHA solving, fingerprint spoofing, browser UA impersonation or proxying.
- Dedupe (`ranking/dedupe.py`): pHash ≤ 6 bits AND CLIP ≥ 0.96 AND compatible brands (checked per
  group) AND title-word overlap ≥ 0.2; hashes shared by > 5 listings are placeholders. Known miss:
  near-identical photos + titles of genuinely different items (e.g. two lookbooks) still merge.
- The worker stores the last refresh time; restarts don't re-run searches early (same for the
  Vestiaire job and the daily recheck). Manual refresh: `api/refresh.py` writes
  `app_state['refresh_request']`; the worker's `ManualRefresh` job (every 10 s) runs it, then
  embeds/scores. Cooldown `RACK_MANUAL_REFRESH_COOLDOWN_MINUTES`.
- Gallery (`api/gallery.py`): opening a listing fetches its item page on demand (Vinted only;
  ≤ once/day/listing) for all photos + description; `ingest.set_images` keeps the fuller photo set
  and `description` is coalesced, so search refreshes don't wipe them. eBay search already has all
  images; Grailed exposes only the cover photo + `photo_count`.
- `docs/security-audit-prompt.md`: the user's audit prompt, to run in a later (security) phase.
- Evaluated and not used: `ebay-node-api` (still needs eBay keys; wraps the same APIs) and the Apify
  "Vestiaire Collective Real-Time Data Scraper" actor (later adopted at the user's request).

- "I bought it" (`api/purchases.py`): copies the listing's first photo (marketplace CDNs only,
  SSRF-checked) and title into a wardrobe `taste_items` row with source, URL, brand, size,
  `purchase_price_gbp`, `purchased_at` and a `saved_snapshot`; deletes the Saved row (so price
  checks stop). The listing row is never deleted; bought listings are hidden from the feed and
  hunts. `POST /api/taste/{id}/undo-bought` restores Saved exactly. Toasts take an optional action.
- Wardrobe value (5a): `purchase_price_gbp` + `custom_value_gbp` on wardrobe items, set via
  `PATCH /api/taste/{id}` (no rescore). Totals are computed client-side in pence
  (`lib/wardrobeValue.ts`): worth = your value, else what you paid; unpriced items aren't counted.

## Phases
0. Setup  1. Skeleton (eBay, basic feed, auth)  2. Taste + ranking  3. More sources + health + dedupe
4. Hunts + notifications  5. Polish (PWA, deal score, landed cost, Web Push, README)

Status: security phase done (docs/security-audit-2026-11-16.md, all 11 findings fixed and
covered by tests/test_security.py). Before going public the user still needs a strong password
and the tunnel + Cloudflare Access.
Security notes:
- Secrets are split: `.env` (shared), `.env.api`, `.env.worker`, `.env.tunnel` (see compose).
- Auth: CF-Connecting-IP is trusted only from `RACK_TRUSTED_PROXIES` (cloudflared; lookup capped
  at 1 s, failures cached 10 min); global login cap; sessions carry an epoch
  (`app_state['auth']`) + password fingerprint (logout-all, password change). Session secret
  must be >= 32 chars. uvicorn runs with `--no-proxy-headers`.
- Worker image downloads: https marketplace CDNs only (`embeddings/images.py`
  `IMAGE_HOST_SUFFIXES`), public IPs, connection pinned to the checked IP (Host + SNI), no
  redirects. Security headers + body-size limits in `api/main.py`.
- Tests: newer FastAPI caches dependency resolution for module-level routers shared across
  test apps, so overrides can be skipped intermittently; the `client` fixture therefore also
  sets the test settings as env vars and points the default engine at the test DB.
- Dev servers for the preview pane: `.claude/launch.json` in the session folder (`rack` =
  docker compose up --build on :8000; `frontend-dev` = Vite on :5173).
Phase 5 done (FX, price history, landed cost, PWA, Web Push, optional Claude re-rank,
mobile pass, Cloudflare Tunnel profile, deploy README). All planned phases complete.
Next: security phase using `docs/security-audit-prompt.md` (user's prompt), when the user asks.
Phase 5 notes:
- FX: `pricing/fx.py` live ECB rates (frankfurter.dev, daily worker job, `app_state['fx']`), static
  fallbacks. Price history: `price_observations`, `pricing/history.py`; a ≥5% cut since first seen
  lifts `deal` and shows "Price cut (was £X)". Landed cost: `pricing/landed.py` (estimate only).
- PWA: `frontend/public/{manifest.webmanifest,sw.js,icon-*.png}`; the SW never caches `/api/*`.
  Web Push: `notify/webpush.py` (pywebpush, VAPID keys in .env via `rack vapid-keys`), expired
  subscriptions (404/410) removed. Needs HTTPS (tunnel) on phones; iOS needs home-screen install.
- LLM re-rank (`ranking/llm.py`, `worker/llm_job.py`): off by default; Claude Opus 5.5 via the
  Anthropic SDK (beta endpoint for `fallbacks: "default"` refusal fallback), effort low, JSON schema
  output, photos as URL images with a text-only retry on 400. Verdicts live in listing_scores.llm_*
  and are re-applied on every rescore (`components.base` keeps the un-adjusted score).
- Compose: API binds 127.0.0.1 by default (`RACK_BIND`); `cloudflared` under profile `tunnel`.
Phase 4 done (hunts, ntfy/Telegram alerts with dedupe, price drops for saved items).
Phase 3 done (Vinted + Grailed live, Vestiaire blocked stub, health panel, dedupe).
73 backend tests (+1 slow) + 10 Vitest pass. Phase 2 notes: 57 backend (+1 slow real-CLIP) + 10 Vitest tests pass; compose stack verified
locally (CLIP weights download to `/data/hf` on first worker run, ~2 min).
eBay fixture is hand-built from the documented schema; its image URLs resolve to eBay's grey placeholder,
so visual matches on fixture data are meaningless. Replace with a live recording once keys exist.
Local `.env` is dev-only (RACK_COOKIE_SECURE=false; dev password in its first-line comment).
Phase 4 notes:
- Hunts (`worker/hunts.py`, `ranking/hunt_match.py`): every query word must appear in brand+title+
  description; unknown size/category/score never excludes. First run (and after editing the search)
  is a silent baseline. Global hard filters (hidden, banned words, fit, excluded designers) apply.
  Free sources only (Vestiaire is paid). Min interval 5 min; worker checks due hunts every minute.
- All worker jobs share one adapter per source (`worker/adapters.py`) so rate limits hold across jobs.
- Alerts (`notify/`): `notify_once` claims a unique key in `notifications` before sending (no
  duplicates); if every channel fails the claim is released for retry. Keys: `hunt:<id>:<source>:
  <source_id>`, `drop:<listing_id>:<price>`. httpx INFO logging is silenced (Telegram token in URL).
- Price drops (`worker/price_drops.py`): every 30 min, saved items not seen/checked for
  RACK_PRICE_CHECK_HOURS are re-checked (Vinted item page, Grailed index object, eBay getItem);
  alert when price falls ≥ both RACK_PRICE_DROP_MIN_PCT and _GBP below the last alerted/saved price.
