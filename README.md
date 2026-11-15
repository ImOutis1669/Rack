# Rack

A personal, self-hosted fashion feed across eBay UK, Vinted UK, Grailed and Vestiaire Collective, ranked by
*your* taste profile rather than your click history. Single user, runs on a small home server.

> **Status:** Phase 1 (skeleton). eBay only, no ranking yet. See `CLAUDE.md` for the roadmap.

## Quick start

```bash
cp .env.example .env
docker compose build
docker compose run --rm api rack hash-password   # paste output into RACK_PASSWORD_HASH (single quotes)
python -c "import secrets;print(secrets.token_urlsafe(48))"   # -> RACK_SESSION_SECRET
docker compose up -d
```

Open http://localhost:8000. For plain-http local testing set `RACK_COOKIE_SECURE=false`.

No eBay keys yet? Load demo listings:

```bash
docker compose exec api rack load-fixture ebay tests/fixtures/ebay/search_sample.json
```

### eBay keys
Create a production keyset at developer.ebay.com → *Application Keys*, then set `EBAY_CLIENT_ID` and
`EBAY_CLIENT_SECRET`. Rack uses the client-credentials grant against the Browse API (`EBAY_GB`).

## Honest caveats
Only eBay is accessed through an official API. Other sources (added in Phase 3) use the endpoints their own
websites call. That may breach those sites' terms of service and can stop working at any time. Rack keeps
volume very low (≥10 s between requests per source, no parallelism, no proxies, no CAPTCHA solving, no
logins) and each source fails independently.

*Deployment (CasaOS, Tailscale, Cloudflare Tunnel + Access) docs arrive in Phase 5.*
