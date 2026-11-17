# Rack security audit (2026-11-17, v2.1 multi-user)

Run with `docs/security-audit-prompt.md` against the v2.1 branch (steps 1-6: accounts,
per-user data, profile and photos, search, web and iOS screens). It builds on the 2026-11-16
audit (RACK-01 to RACK-11), whose fixes and regression tests in `tests/test_security.py` and
`tests/test_app_token.py` all still pass.

## Phase 0: scope and threat model

- **Stack:** Python 3.12, FastAPI, SQLAlchemy 2 async, Postgres 16 + pgvector; React + Vite web
  app; Expo / React Native iOS app; shared TypeScript in `shared/`.
- **What it is:** a self-hosted fashion feed on the owner's Windows PC (Docker Desktop). From
  v2.1 the owner invites a few friends (about 1-5), who use the web app; the iOS app is the
  owner's only. Today it's reached over Tailscale; a later version puts it on the internet
  through Cloudflare Tunnel, so this audit assumes it is public.
- **Sensitive data:** passwords (argon2 hashes), each person's taste, wardrobe photos (from
  their phones), saved items, hunts, push subscriptions; the owner's licensed font and icons;
  marketplace API keys in `.env.worker`.
- **Threats, in order:** an anonymous internet attacker (login, sign-up, invite guessing,
  enumeration); a logged-in friend reaching another person's data (IDOR, privilege escalation to
  owner); someone using the same browser after another account; abuse of shared resources
  (marketplace load, eBay quota, CPU).

## Summary

| ID | Finding | Severity | Status |
|---|---|---|---|
| RACK-21 | Private photos could be shown from the browser cache to another account on the same browser | **Medium** | Fixed |
| RACK-22 | Login CSRF: a cross-site form could sign a browser into another account | Low | Fixed |
| RACK-23 | Web recent searches stayed in the browser after logging out | Low | Fixed |
| RACK-24 | A disabled account's queued live searches still ran | Low | Fixed |
| RACK-25 | The global login cap lets an anonymous attacker lock everyone out for 15 minutes | Low | Accepted, see below |
| RACK-26 | A push endpoint moves to whoever subscribes it last | Info | Accepted |
| RACK-27 | Logged-in users can make the server fetch and encode listing thumbnails | Info | Accepted |
| RACK-28 | Friends see source error messages | Info | Checked: no secrets in them |
| RACK-29 | Sign-up says when a username is taken | Info | Accepted (needs a valid invite) |
| RACK-30 | `minimatch` advisory in the iOS app's build tooling | Info | Not shipped in the app |

No Critical or High findings. Dependency audit: Python (pip-audit) none; web and shared npm
none; iOS app one moderate advisory in build-time tooling (RACK-30). torch/torchvision are CPU
builds pip-audit can't look up.

## RACK-21: private photos from the browser cache (CWE-524, CWE-639) - Medium, fixed

**Where:** `api/me.py` `get_avatar` (`private, max-age=31536000, immutable` on
`/api/me/avatar?v=N`), `api/admin.py` `user_avatar`, `api/taste.py` `item_image`
(`private, max-age=86400`), `api/thumbs.py` `taste_thumb` (`private, max-age=604800, immutable`).

**Risk:** `private` keeps a response out of shared caches but not out of the browser's own
cache, which is keyed by URL, not by who is logged in. The avatar URL is `/api/me/avatar?v=N`
for everyone, and every account's first photo is `v=1`. If a friend logs in on a browser the
owner used, their header shows the owner's photo straight from the cache; anyone on that browser
can also open `/api/taste/<id>/image` for ids the earlier account viewed and get the cached
photo without the server being asked.

**Fix:** `api/private_files.py` `private_file()`: `Cache-Control: private, no-cache` plus a
strong ETag; the browser keeps the copy but must ask each time, the route checks the owner
first (404 for anyone else), and an unchanged file answers `304 Not Modified` with no body.
Shared listing thumbnails (`/api/img/*`) keep their long immutable cache. The iOS app is one
account per phone and empties its image cache on log out, so it's unaffected.

**Verified by:** `test_private_photos_are_revalidated_every_time` (no-cache + ETag, 304 on a
repeat, 404 for another account presenting the same ETag, listing thumbnails unchanged).

## RACK-22: login CSRF (CWE-352) - Low, fixed

**Where:** `api/auth.py` `login`. Sign-up already required the `X-Requested-With` header; login
didn't. With `SameSite=Lax` and JSON-only bodies an attack is hard, but a successful one signs
the victim into the attacker's account, where their uploads and taste would go.

**Fix:** `login` calls `_require_csrf` (the web app always sends the header). The iOS token
login sets no cookie and needs no header.

**Verified by:** `test_login_needs_the_csrf_header`; every login in the test suite now sends it.

## RACK-23: recent searches survive log out (CWE-359) - Low, fixed

**Where:** `frontend/src/pages/Search.tsx` kept `rack.recentSearches` in localStorage; log out
and a 401 cleared feed snapshots but not this. **Fix:** `lib/recentSearches.ts`
`clearRecent()` on log out, log out everywhere, account deletion and any 401 (`api/client.ts`
`onSignedOut`). The iOS app clears it in `clearDeviceData`.

## RACK-24: disabled accounts' live searches (CWE-285) - Low, fixed

**Where:** `worker/live_search.py` `_claim` picked the oldest queued request regardless of its
account. Disabling a friend stopped their logins, hunts, alerts and scoring, but a search they'd
queued still hit the marketplaces. **Fix:** queued requests of disabled accounts are marked
`error` before claiming. **Verified by:** `test_disabled_accounts_searches_never_run`.

## RACK-25: global login cap lockout (CWE-645) - Low, accepted

60 failed logins from anywhere in 15 minutes close login for everyone (the brief keeps a global
cap against distributed guessing). Before Rack goes public (Cloudflare step), add a Cloudflare
rate-limiting rule on `/api/auth/*` so most bad traffic never reaches the app, and keep the
per-IP and per-username limits. Logged-in sessions are unaffected by the cap.

## Informational

- **RACK-26:** `push/subscribe` re-assigns an existing endpoint to the subscriber. Taking over
  someone's device would need their push endpoint URL, which is a secret capability URL that
  never leaves their browser. Accepted.
- **RACK-27:** `/api/img/{id}` fetches a marketplace photo (allow-listed hosts, pinned IP, 10 MB,
  6 at a time) and encodes AVIF/WebP on demand. Only logged-in, invited users can call it.
- **RACK-28:** Sources health shows `last_error` to everyone from v2.1. Errors are
  `ExceptionName: message`; eBay's OAuth token and Grailed's key travel in headers, never in
  URLs, so no secret appears.
- **RACK-29:** a valid invite holder learns whether a username exists (409). Needed to pick a
  name; invites are single-use and owner-made.
- **RACK-30:** `minimatch` (GHSA-g3hv-75wg-m249) through Expo CLI tooling, dev-time only.

## Checked and found sound

- **Authentication:** argon2; unknown users verified against a dummy hash (same timing); one
  message for unknown, wrong and disabled; limits per IP, per username and global; cookie and
  bearer token signed with different salts; claims `{u, e, p}` with a strict integer user id,
  that user's epoch and password fingerprint; "log out everywhere" and password changes affect
  only that user; disabling or deleting ends sessions within the 5 s cache (`forget_user` makes
  it immediate on this process).
- **Authorisation:** every `/api` route depends on `require_user` (route sweep test) and answers
  401 anonymously; owned tables are listed and checked (`test_every_owned_table_is_checked`);
  the IDOR matrix in `test_multiuser.py` has user A use user B's ids on every endpoint (404, B's
  data unchanged); `/api/admin/*` and `/api/owner-assets/*` are owner-only (403); the owner
  can't be disabled or deleted; friends can't raise their role (no endpoint changes it).
- **Invites:** 128-bit codes, only a SHA-256 stored, single use under `SELECT ... FOR UPDATE`,
  7-day expiry, revocable, failures rate-limited per IP and globally, code in the URL fragment
  (never in logs or Referer).
- **Injection:** all SQL through bound parameters; the search SQL uses literal column
  expressions with no user input, `SET LOCAL` a module constant; LIKE filters escape `% _ \`.
- **XSS:** React/React Native escape text; display names are cleaned; the only
  `innerHTML` is Basil icon markup, validated client-side to plain `<path>` elements with an
  attribute allow-list (`lib/ownerAssets.ts` `validPack`).
- **Uploads:** wardrobe and profile photos are decoded with the size and decompression-bomb
  checks, re-encoded without metadata (location, camera), stored under `uploads/<user id>/` and
  served only to their owner; account deletion removes files, cached thumbnails and the photo.
- **Licensed assets:** fonts and icons are out of the public bundle (checked in the built image:
  no `fonts/`, no icon path data in `assets/*.js`); served by an allow-list of file names with a
  resolved-path check.
- **Shared resources:** one crawler at the same rate limits; friends' hunts capped (5, hourly,
  run-now too); live search one at a time per person, cooldowns, a 5-deep queue; eBay searches
  counted per person.
- **Secrets and logs:** no passwords, invite codes or tokens logged; invite codes shown once.
