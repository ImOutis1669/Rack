# Rack

A personal, self-hosted fashion feed across eBay UK, Vinted UK, Grailed and Vestiaire Collective, ranked by
*your* taste profile rather than your click history. Single user, runs on a small home server.

> **Status:** Phase 3. Vinted and Grailed live, eBay ready for keys, Vestiaire blocked. See `CLAUDE.md`.

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

## Teaching it your taste
1. **Settings:** designers (love / like / curious / exclude), a few words about your style, your minimum
   inseam/sleeve and other measurements (cm or inches), sizes, budget and how much exploration you want.
2. **Wardrobe:** upload photos of clothes you own and love. **Wishlist:** photos, links to listings or
   images, or a short text description.
3. Use 👍 / 👎 on listings. Each card says *why* it's there.

The worker computes CLIP embeddings on the CPU. The first run downloads the model (~600 MB) into the data
volume. It rescores the whole feed within about a minute of any change. Listings whose stated
measurements are too short for you are hidden; listings without measurements never are. A designer you
list only ever *adds* to a score: unbranded or unknown items are not pushed down for it.

## Sources
| Source | How | Notes |
|---|---|---|
| eBay UK | Official Browse API | Needs your keys (below). |
| Vinted UK | Its public search page | Price shown includes Vinted's compulsory buyer-protection fee (postage extra). |
| Grailed | The Algolia search index Grailed's own site uses | grailed.com blocks Rack, so this uses the public search key their site gives every browser (`GRAILED_ALGOLIA_*` in `.env`). If Grailed rotates it, source health shows the error; update the key. No descriptions, so measurements come from titles only. |
| Vestiaire | — | Blocked by Cloudflare's human check. Rack checks once a day and says so in source health; it won't try to get around it. |

Tap the source dots under the header for each source's status, last run and last error. The same item
listed more than once (another site, a repost, or one listing per size) is shown as a single card with a
buy button per copy.

## Honest caveats
Only eBay is accessed through an official API. Other sources (added in Phase 3) use the endpoints their own
websites call. That may breach those sites' terms of service and can stop working at any time. Rack keeps
volume very low (≥10 s between requests per source, no parallelism, no proxies, no CAPTCHA solving, no
logins) and each source fails independently. To compute image similarity, Rack downloads one thumbnail per
listing from the marketplace's image CDN (`RATE_IMAGES`, default one per second). It keeps only the
embedding, not the image.

*Deployment (CasaOS, Tailscale, Cloudflare Tunnel + Access) docs arrive in Phase 5.*
