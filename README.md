# Rack

A personal, self-hosted fashion feed across eBay UK, Vinted UK, Grailed and Vestiaire Collective, ranked by
*your* taste profile rather than your click history. Single user, runs on a small home server.

> **Status:** Phase 4. Vinted and Grailed live, eBay ready for keys, Vestiaire blocked. See `CLAUDE.md`.

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
| Vestiaire | Optional paid Apify actor (residential proxies) | vestiairecollective.com blocks Rack with a Cloudflare human check, even from a home connection. Add an Apify token (`APIFY_TOKEN`) to run the `b2b_leads/vestiaire-collective-real-time-data-scraper` actor: billed per result (~$25 / 1,000; free Apify plans return 2 per run). Defaults: 3 searches × 10 results once a day, hard stop at 300 results a month. Without a token Rack just checks daily and shows "Blocked". |

Tap the middle of a listing's photo to open every photo full-screen (swipe, arrow keys or
thumbnails), with the full description. Vinted's extra photos are fetched when you open the listing;
Grailed only shares its cover photo.

## Hunts and alerts
**Hunts** are saved searches (words, category, max price, sizes, sources) that run on their own schedule,
from every 5 minutes to daily. Every word you type must appear in the listing. The first run quietly
records what's already listed; after that, new matches are pushed to your phone. Your hidden sellers,
banned words and fit rules still apply. Use "Hunt for this" in a listing's ⋯ menu to start one from a
listing. Saved items are re-checked every few hours and you're alerted when the price drops by at
least 5% and £5 (configurable).

Alerts go to [ntfy](https://ntfy.sh) and/or Telegram, set in `.env` (see `.env.example`); use **Send
test alert** in Settings to check. ntfy.sh is a public server: anyone who knows your topic can read the
alerts, so use a long random topic (or self-host ntfy). Each alert is sent once.

**Refresh** (top of the feed) re-ranks immediately and asks the worker to search the free sources
now; it's limited to once every 5 minutes (`RACK_MANUAL_REFRESH_COOLDOWN_MINUTES`). Vestiaire isn't
included because it's billed per result.

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
