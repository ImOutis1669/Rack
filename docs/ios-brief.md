# Rack for iOS (React Native + Expo): brief for the next session

Paste everything below the line into a new Claude Code chat opened on `C:\dev\rack`.

---

Rack v1.2 is done, tagged `v1.2` and pushed (GitHub: ImOutis1669/Rack-). Now I want Rack as a
**native iOS app** built with **React Native + Expo**, sideloaded onto my iPhone, instead of the
Safari home-screen web app. Read `CLAUDE.md`, `DESIGN.md`, the design skills in `.claude/skills/`
(`rack-apple-design` first) and `docs/release-notes-v1.2.md` first.

## Goal
Native screens, gestures, lists and sheets that use the iPhone properly: native rendering at
120 Hz, the real iOS tab bar and large titles, native sheets, haptics, Face ID, the native share
sheet, the photo library and camera. **The backend does not change** (except the login, below):
it keeps running in Docker on my gaming PC, and the app talks to it over Tailscale at
`RACK_PUBLIC_URL` (`.env`). The web app stays as it is and keeps working.

## Constraints you need to know
- **I have no Mac**, only this Windows PC and my iPhone. Builds happen in the cloud; no Xcode here.
- **Sideloading with a free Apple ID** (for now): Sideloadly or AltStore on Windows signs the
  `.ipa`. The app then expires after 7 days (AltStore can re-sign it automatically), at most 3
  sideloaded apps, and **no push notifications** (Apple's push service needs the paid $99/year
  developer account). Alerts keep coming through ntfy/Telegram as today. Keep the design ready for
  the paid account later (push, TestFlight) but don't depend on it. Check Apple's and Expo's
  current rules before relying on any of this; they change.
- **Licences:** the repo is public. Neue Montreal (personal-use font) and Basil Icons (Craftwork:
  no sharing the files) must never be committed, and a GitHub Actions build only sees the repo, so
  it can't bundle them. **Default: SF Pro (system font) and SF Symbols (`expo-symbols`)**, which
  are free to use in iOS apps and look the most native. Ask me before choosing anything else
  (e.g. an encrypted CI secret holding my own font/icon files).
- **Privacy rules carry over** (`CLAUDE.md`): no eBay user data stored; anything the app caches on
  the phone (feed snapshot, images) follows the web app's rules: at most 24 h, cleared on log out /
  log out everywhere / any 401. Secrets only in the Keychain (`expo-secure-store`), never in the
  bundle or the repo.
- **Public CI artifacts:** on a public repo, Actions logs and artifacts can be seen by other GitHub
  users. Never print secrets in a build; keep `.ipa` artifacts short-lived (1 day); nothing secret
  may be baked into the app (the API URL is only reachable inside my tailnet, so it's fine).
- **Security:** the API was audited (`docs/security-audit-2026-11-16.md`). Any new auth surface must
  keep its guarantees: login rate limits, session epoch / "log out everywhere", password-change
  invalidation, CSRF protection for cookie sessions, no secrets in logs.

## Working agreements (same as v1.1/v1.2)
- Plan first and wait for my OK, one step at a time, in the order below.
- Small typed modules; pytest for backend changes, Vitest/Jest for shared and app logic.
- Before each commit: `uv run python -m pytest` (pytest.exe is blocked on this PC), `ruff`, `mypy`,
  `tsc`, the web app's `vitest`, and the mobile app's tests and `tsc`.
- Keep `CLAUDE.md`, `DESIGN.md` and the README current; add a `mobile/` section.
- Commit after each step; push only when I say.
- Testing loop: there's no iOS simulator on Windows. Use **Expo Go on my iPhone** (dev server on
  this PC, reachable over Tailscale/LAN) for anything Expo Go supports, a **development build**
  once a native module needs it, and `expo start --web` in the browser pane only for rough layout
  checks. Ask me for iPhone screenshots or to try gestures when a step needs real hardware.

## Steps

### 0. Plan and set-up
- Propose the layout: an Expo app in `mobile/` (TypeScript, `expo-router`, latest stable SDK at the
  time), and a **shared** package for code both apps use (types, API client, pure logic), wired
  with npm workspaces or TS paths + Metro `watchFolders`. The web app must keep building in Docker.
- Pick libraries and say why, e.g. `expo-router` (native stack + **native tabs**, which give the
  iOS 26 Liquid Glass tab bar), `expo-image` (disk cache, AVIF), FlashList (masonry), TanStack Query,
  `expo-secure-store`, `expo-local-authentication`, `expo-haptics`, `expo-image-picker`,
  `expo-symbols`, `expo-web-browser`. Check each still exists and is maintained before using it.
- Show me a screen-by-screen map of the web app to native screens before writing code.

### 1. Native-friendly login (backend)
The web app uses an HttpOnly session cookie + `X-Requested-With` CSRF header. Decide with me:
(a) keep cookies (iOS's networking stores them), or (b) a **bearer token** for the app, issued at
login, stored in the Keychain, unlocked with Face ID, revocable by "log out everywhere" and by a
password change. Recommend one with reasons; whichever, add tests in the style of
`backend/tests/test_security.py` and keep the web app unchanged.

### 2. Shared code
Move what both apps need out of `frontend/src` into the shared package without changing behaviour:
`api/types.ts`, the API client (with a pluggable fetch/auth so the web keeps cookies and the app
uses its choice from step 1), and the pure parts of `lib/` (`format`, `grid`, `wardrobeValue`,
`trend`, `units`, `landed`, `seller`, `vote`, `hunts`, `bought`, `tasteItem`, `share`, `sheetDrag`,
`thumbs`…). Their existing tests move with them and keep passing.

### 3. App shell
Native tab bar (Feed, Hunts, Saved, Wardrobe) with Liquid Glass on iOS 26; native large titles
(the page titles: "Rack" on the feed, Saved, Hunts, Wardrobe, Settings); Settings from the header;
login screen; light and dark following the system; Rack's tokens from `DESIGN.md` mapped to
native colours.

### 4. Feed
Masonry grid (FlashList) of `/api/img/{id}` thumbnails (AVIF, `v=` cache key as in
`lib/thumbs.ts`) with `expo-image` caching; category chips (incl. Accessories); sort menu (native
menu); filters sheet; pull to refresh (and the manual refresh with its cooldown); infinite scroll;
seen/visit tracking; the 24 h snapshot for instant start; tile actions (save, vote) with haptics.

### 5. Listing sheet
Native sheet presentation (swipe down to close comes free), photo pager with pinch-zoom, the action
row (vote, save, share via the native share sheet, hunt, ⋯ menu), price/landed cost, "I bought it",
and "Buy on …" opening the marketplace (in-app browser or the marketplace's app).

### 6. Saved, Hunts, Wardrobe
Saved list; hunts list + form + run now + matches; Wardrobe/Wishlist with photo upload from the
camera or library, the item sheet with edit mode, wardrobe value, estimates and the trend
sparkline; I bought it / undo.

### 7. Settings and sources
Profile (style text, sizes, budgets, categories, fit, banned words), designers and adjacent
designers, hidden sellers/brands, notification channels (status + test; no Web Push in the app),
the Sources sheet with eBay usage, log out / log out everywhere.

### 8. Native polish
Haptics on key actions, Face ID unlock, the `?perf=1` readout's equivalent (dev menu), offline
behaviour (snapshot shown, clear errors), accessibility (Dynamic Type, VoiceOver labels,
Reduce Motion), app icon and splash from `frontend/public/icon-*.png`.

### 9. Build and sideload
- A **GitHub Actions** workflow on a macOS runner: `expo prebuild`, then build an **unsigned
  `.ipa`** (e.g. `xcodebuild … CODE_SIGNING_ALLOWED=NO`), uploaded as a 1-day artifact. Manual
  trigger only. Confirm macOS runner minutes are free for this public repo before relying on it.
- Step-by-step for me: install Sideloadly (or AltStore + AltServer) on Windows, sign with my Apple
  ID, install, enable Developer Mode on the iPhone, trust the profile, and re-sign every 7 days
  (or set AltStore to do it).
- Note what changes with the paid developer account (1-year signing, push notifications through
  APNs, TestFlight), so we can switch later.

### When everything is done
Update the README, `DESIGN.md`, `CLAUDE.md`, write `docs/release-notes-v2.0.md` and tag `v2.0`
(push only when I say).
