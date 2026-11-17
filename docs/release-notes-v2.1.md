# Rack v2.1

Released 17 November 2026. Rack is no longer just yours: you can invite a few friends, each with
their own account and their own feed, while one crawler keeps the marketplaces' load the same.
There's a Profile in place of the settings gear, a search across every source, and the iPhone
app gets inline titles. Plan: `docs/v2.1-plan.md` (from `docs/v2.1-brief.md`).

## Friends' accounts
- **Invite only.** You create a single-use link in **Profile > Friends and invites** (web). It
  expires after 7 days and you can revoke it; the code is shown once and only its hash is
  stored. Your friend opens it, picks a username and password, and is in.
- **Everyone has their own Rack:** taste, designers and sizes, wardrobe and wishlist photos,
  Saved, votes, seen items, hunts, hidden sellers and brands, and alerts. Listings, photos and
  prices are shared. No one can see anyone else's things (tested by having one account try every
  other account's ids).
- **Same load on the marketplaces.** Everyone's searches are merged into one rotation with the
  same rate limits, so more people means each search comes round less often, not more traffic.
- **Friends' limits** (you have none): 5 hunts each, run hourly at most, and sold-price checks
  for their first 30 wardrobe items. Their feeds re-rank at most every 10 minutes when only new
  listings arrived (straight away when their own taste changes). All in `.env` as `RACK_FRIEND_*`.
- **Friends use the web app.** They get the system font and standard icons: Neue Montreal and
  Basil are your personal-use copies, now sent only to your account after you log in (they've
  left the public site entirely). Their alerts are Web Push on their own phone; ntfy and
  Telegram stay yours.
- **You manage them** on the Friends page: who's active, their hunts and eBay searches today,
  disable or delete an account.

## Profile
- **Your photo or initials replace the settings gear** on every page, web and iPhone. Profile
  shows your photo (take, choose with a square crop, or remove), name, @username and when you
  joined, then **Settings** (which opens inside the same sheet), Sources, change password, log
  out, log out everywhere and a short privacy note. Friends also get "Delete my account", which
  removes everything of theirs at once.
- Photos are re-saved without location or camera details and are only ever shown to their owner.

## Search across all sources
- **The magnifying glass in the feed's header.** Results from everything Rack has collected
  appear as you type, typos and partial words included ("geobaskt" finds Geobaskets), with
  filters for source, category, size and price, and sorting. 9-49 ms on 15,000 listings.
- **"Search eBay, Vinted and Grailed now"** asks each site directly, once, at the crawler's
  polite pace; new results join as each site answers. One at a time per person, with a short
  wait between searches (30 s for you, 2 minutes for friends).
- **"Save as hunt"** turns a search into a hunt. Recent searches stay on the device and are
  cleared when you log out.

## Logging in
- **With a username now.** Yours is **Outis** (set as `RACK_OWNER_USERNAME` in `.env.api`;
  usernames are case-insensitive). The first login after the upgrade creates your account from
  your current password, with all your existing data.
- **Change your password in Profile.** It logs out your other devices; the one you're on stays
  logged in. Forgotten it? `docker compose exec api rack reset-password outis`.
- Login is limited to 5 tries per address and per username, and 60 in total, per 15 minutes,
  and never says whether a username exists.

## iPhone app
- **Titles sit inline** on the left of each tab's header ("Rack", "Hunts", "Saved",
  "Wardrobe"), with the buttons in one glass group on the right ending in your avatar. No more
  large titles.
- Profile, Search and the username login as above. Tried in Expo Go on 17 November against a
  test copy of the v2.1 server: the photo upload needed a fix (Expo SDK 58 uploads only real
  files), which also fixes adding wardrobe photos.

## Security
A full audit of the multi-user version: `docs/security-audit-2026-11-17.md`. No critical or
high findings; four smaller ones fixed (your photos can't be shown to someone else from a shared
browser's cache, login requires the anti-forgery header, recent searches clear on log out, a
disabled friend's queued searches don't run).

## Before you upgrade the server
The live server still runs v2.0. When you rebuild it (`docker compose up -d --build`):
- Migrations 0019-0021 run on start: accounts, per-user data (all of it becomes yours: tested on
  a copy of the real database, identical row counts) and the search indexes.
- You and the iPhone app log in once more, with **Outis** and your current password.
- The font and icon files moved from `frontend/public/fonts/` and
  `frontend/src/components/icons/basil.generated.ts` to `frontend/private/` (done on this PC;
  git-ignored as before). The iPhone build's `npm run private-assets` reads them from there; run
  `npm run pack-secrets` again before the next GitHub Actions build.
- A new iPhone build (GitHub Actions) brings the app's changes to the sideloaded app.

## Not in v2.1
Public access through Cloudflare Tunnel (and the notes on moving to a dedicated server) moved to
a later version. Until then friends can reach Rack only over your tailnet. When it goes public,
add a Cloudflare rate limit on `/api/auth/*` (audit RACK-25).

## Numbers
Backend 304 tests, web 63, shared 115, iOS 47. Main web script 137 kB gzipped (v1.2: 148 kB).
