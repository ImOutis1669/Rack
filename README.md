# Rack

A personal, self-hosted feed of second-hand menswear from eBay UK, Vinted UK and Grailed. It ranks listings by **your** taste profile, not your click history: your
wardrobe photos, designers, style notes and fit. Saved hunts and price drops alert your phone.
It's for a single user, and it runs in Docker on your own PC.

## What it does
- **One ranked feed** across marketplaces. Each card shows the price, a delivered-cost estimate for
  imports, your measurements check, and a *Why this?* line ("Looks like your black derbies · Rick
  Owens (love) · ~30% under similar listings").
- **Taste from images**: a CLIP model compares listing photos with your wardrobe and wishlist.
  Upvotes and downvotes nudge it further. A designer you list only ever *adds* to a score, so unbranded items are never
  pushed down.
- **Fit for a tall frame**: inseam, sleeve, pit-to-pit and length are read from listing text (cm or
  inches, "W32 L34"). Listings that are too short are hidden; listings with no measurements never are.
- **Hunts**: saved searches checked every 5 minutes to daily, with alerts for new matches. Turn on
  "Size must match" to skip listings without your size; UK, EU and US shoe sizes are compared
  (UK 9 = EU 43) and W32 matches 32.
- **I bought it**: move a saved item into your wardrobe with the price you paid (its photo then
  shapes the feed, and its price alerts stop). Undo puts it back in Saved.
- **Wardrobe value**: add what you paid and what each item is worth now, or let Rack estimate it
  from similar items (same brand, similar photo, same category): the median Grailed sold price when
  there are enough recent sales, else the median asking price, with how many it's based on. Items
  get a rising/falling sold-price trend over 30/90 days with a sparkline when there's enough data.
- **Wardrobe and wishlist** as clean photo tiles; tap one for everything about it (size, category,
  price paid, value, purchase date, a link to the original listing) and edit it there.
- **Share** a listing's marketplace link from its sheet (the iOS share sheet, or copy).
- **Price drops** on saved items, **deal score** from similar listings and the item's own price cuts.
- **Duplicates merged**: the same item listed twice (another site, a repost, or one listing per size)
  becomes one card with a buy button per copy.
- **Installable app** (PWA) with push notifications, a full-screen photo gallery and an iOS-style
  layout: a Liquid Glass tab dock and top bar, upvote/downvote arrows, sheets that spring.
- **Fast on the phone**: small cached WebP thumbnails for tiles, the last feed shown instantly on
  open, only the tiles near the screen kept in the page, details prefetched on touch, compressed
  and split JavaScript. Add `?perf=1` to the address to see timings on the device.
- **eBay without storing eBay users' data**: listings come from eBay's official API; seller names
  and locations are never stored, and eBay listings are deleted a week after they go.

What's new in v1.2: [docs/release-notes-v1.2.md](docs/release-notes-v1.2.md)
(v1.1: [docs/release-notes-v1.1.md](docs/release-notes-v1.1.md)).

## Requirements
Windows 10/11 with **Docker Desktop** (WSL 2 backend) and a few GB of disk for the images, the model
and data. The image model runs on the CPU, so no GPU is needed.

## Setup
Settings live in `.env`. Secrets are split so each container only gets what it needs:
`.env.api` (password hash, session secret), `.env.worker` (marketplace and Anthropic keys)
and `.env.tunnel` (Cloudflare token).
```powershell
cd C:\dev\rack
copy .env.example .env
copy .env.api.example .env.api
copy .env.worker.example .env.worker
docker compose build
docker compose run --rm api rack hash-password      # paste into .env.api: RACK_PASSWORD_HASH='...'
python -c "import secrets;print(secrets.token_urlsafe(48))"   # -> .env.api: RACK_SESSION_SECRET
docker compose run --rm api rack vapid-keys          # paste both lines into .env (Web Push)
docker compose up -d
```
Use a long passphrase, not a short number: the app is reachable from the internet once the tunnel
is on. The API logs a warning at startup if a setting is unsafe (short secret, plain-text hash,
https without secure cookies).
Open http://localhost:8000 and log in. For plain-http testing on this PC set
`RACK_COOKIE_SECURE=false`; set it back to `true` before going public.

On first start the worker downloads the image model (about 600 MB, roughly 2 minutes) into the
`rack_data` volume. Docker Desktop's *Start when you sign in* plus `restart: unless-stopped` keeps Rack
running across reboots. For alerts to arrive, the PC must not sleep (Windows Settings → Power).

**Optional: Neue Montreal.** Rack's UI font is Neue Montreal by Pangram Pangram (free for
personal use, not redistributable, so not in this repo). Download it from pangrampangram.com and
copy `neuemontreal-regular.otf`, `neuemontreal-medium.otf` and `neuemontreal-bold.otf` into
`frontend/public/fonts/`, then rebuild. Without them Rack uses the system font (SF Pro on iPhone).

**Optional: Basil icons.** Rack can use the free [Basil Icons](https://craftwork.design) pack from
Craftwork. Its licence doesn't allow sharing the files, so they're not in this repo: download the
pack yourself, unzip it, then run `cd frontend && npm run icons -- "<unzipped>/Basil Icons/svg"`
and rebuild. Without it Rack uses lucide icons.

## Sources
| Source | How | Notes |
|---|---|---|
| eBay UK | Official Browse API | Create a production keyset at developer.ebay.com → *Application Keys*; set `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`. |
| Vinted UK | Its public search page | Price includes Vinted's compulsory buyer-protection fee (postage extra). Opening a listing fetches all its photos and the description. |
| Grailed | The Algolia search index Grailed's own site uses | grailed.com blocks Rack, so this uses the public search key their site gives every browser (`GRAILED_ALGOLIA_*` in `.env.worker`). If Grailed rotates it, source health shows the error; update the key. Cover photo only, no descriptions. |

Tap the coloured dots under the header for each source's status, last run and last error.
**Refresh** re-ranks now and searches the sources (at most every 5 minutes).

## Teaching it your taste
1. **Settings**: designers (love / like / curious / exclude), a few words about your style, minimum
   inseam/sleeve/length (cm or inches), sizes, budget, exploration share and banned words.
2. **Wardrobe / Wishlist**: upload photos of clothes you own or want, paste an image or listing link,
   or describe it ("long black wool overcoat").
3. Use the upvote / downvote arrows, ☆ save, share (the marketplace link, via the iOS share sheet
   or copied), and ⋯ to hide a seller or brand, or **Hunt for this**.

## Alerts
Hunt matches and price drops go to any channel you set up; **Settings → Alerts → Send test alert**
checks them all. Each alert is sent once.
- **Phone app (Web Push)**: open Rack over HTTPS (your tunnel address, below), install it (Android:
  *Install app*; iPhone: Share → *Add to Home Screen*, then open it from the home screen), then
  Settings → *Enable push here*.
- **ntfy**: set `NTFY_TOPIC` to a long random name and subscribe to it in the ntfy app. ntfy.sh is
  public: anyone who knows the topic can read your alerts.
- **Telegram**: create a bot with @BotFather; set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

## Using it from your phone (Cloudflare Tunnel)
Rack listens only on this PC by default. To reach it from anywhere over HTTPS without opening router
ports:
1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → *Create a tunnel* (Cloudflared).
   Copy the token into `.env.tunnel` as `TUNNEL_TOKEN`.
2. Add a *public hostname* (e.g. `rack.yourdomain.com`) with service `http://api:8000`.
3. In `.env`: `RACK_PUBLIC_URL=https://rack.yourdomain.com` and `RACK_COOKIE_SECURE=true`.
4. `docker compose --profile tunnel up -d`
5. **Strongly recommended**: Zero Trust → Access → Applications → add the hostname with a policy that
   allows only your email (one-time code). The app then sits behind two logins.

Before going public: use a long, unique password (`rack hash-password`), keep the `.env*` files
private, and keep `RACK_COOKIE_SECURE=true`. Login is rate-limited (5 attempts per IP and 30 in
total per 15 minutes). **Settings → Security → Log out all devices** ends every session (do it if a
device is lost); changing your password does the same automatically. A security review lives in
`docs/security-audit-2026-11-16.md`; `scripts/audit.sh` checks dependencies for known issues.

**LAN only instead?** Set `RACK_BIND=0.0.0.0` and open `http://<pc-ip>:8000`. Push notifications and
app install need HTTPS, so they won't work this way. [Tailscale](https://tailscale.com) with
`tailscale serve` is another option for private HTTPS.

## Optional: Claude second opinion
With `LLM_ENABLED=true` and an Anthropic API key (`ANTHROPIC_API_KEY` in `.env.worker`), Claude (Opus 5.5 by default,
`LLM_MODEL`) looks at the top of your feed, photos included, against your taste profile. It gives
each listing a 0-10 verdict and a short reason, which leads the *Why this?* line. Each listing is
judged at most every 3 days, and calls are capped at 12 a day (roughly $0.10-0.20 each). The app is
complete without it.

## Data, backups, updates
- Data lives in two Docker volumes: `pg_data` (database) and `rack_data` (uploads, model cache).
- Backup: `docker compose exec db pg_dump -U rack rack > rack-backup.sql`, plus copy your `.env*` files.
  Restore with `psql` into a fresh `db`. Uploaded photos are in `rack_data:/data/uploads`.
- Update: `git pull`, then `docker compose build && docker compose up -d` (migrations run automatically).
- Logs: `docker compose logs -f worker`.

## Costs
eBay, Vinted and Grailed access is free. Exchange rates come from the ECB via frankfurter.dev (free).
Optional paid extra: the Claude second opinion (capped per day).

## Honest caveats
- Only eBay uses an official API. Vinted and Grailed are read through the same public endpoints
  their websites use. That may breach their terms of service and can stop working at any time.
  Rack keeps volume low: at least 10 s between requests per source, one request at a time, an honest
  User-Agent, no logins and no CAPTCHA solving. Each source fails on its own without breaking the feed.
- To compare photos, Rack downloads one thumbnail per listing from the marketplace's image CDN (about
  one per second per host) and keeps only the embedding. Photos you see are loaded from the
  marketplaces directly.
- Delivered-cost figures are estimates (UK VAT 20%; duty and a courier fee above £135, often £0 duty
  for EU-made goods). Check the checkout before buying.

## iPhone app (in progress)
A native iOS app (React Native + Expo) is being built in `mobile/`, sideloaded with a free Apple
ID. The web app stays as it is. See `mobile/README.md` and `docs/ios-brief.md`.

## Development
See `CLAUDE.md` for architecture, commands and conventions. Backend: `cd backend && uv run pytest`;
frontend: `cd frontend && npm test`; shared code: `cd shared && npm test`; iOS app:
`cd mobile && npm test`.
