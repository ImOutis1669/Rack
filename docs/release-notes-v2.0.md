# Rack v2.0

Released 17 November 2026. Rack is now a native iPhone app as well as the web app: everything in
`docs/ios-brief.md` (steps 0–9), plus a hunt fix the iPhone turned up. The web app keeps working
as before.

## The iPhone app
React Native + Expo (SDK 58), in `mobile/`. Built in the cloud and installed with your own Apple
ID: see `docs/ios-sideload.md`. The first cloud build (22 minutes) was sideloaded with
Sideloadly and checked on the iPhone on 17 November.

- **Feels like iOS:** the real tab bar (Liquid Glass, shrinks as you scroll), large titles,
  native sheets you swipe down, native long-press menus, the iOS share sheet, haptics, and
  your Neue Montreal and Basil icons (or SF Pro and SF Symbols without them).
- **Feed:** the same ranked feed in a two-column grid of sharp AVIF photos; sort and filters in
  the header, categories under the title, pull to refresh (asks the sources for new listings),
  long-press a tile to save or vote. Opens instantly with your last feed.
- **Listings:** swipe through photos, pinch or double-tap to zoom, votes, save, share, "Hunt for
  this", "I bought it", hide seller or brand, and "Buy on ..." straight into the marketplace's
  app.
- **Saved, Hunts, Wardrobe:** everything from the web, including the hunt form, matches, adding
  wardrobe photos from the camera or library, values, estimates and the sold-price trend.
- **Settings:** every taste setting, alerts, hidden sellers and brands, and source health with
  eBay's daily usage.
- **Face ID:** Rack asks for Face ID when it opens and after a minute away, and hides itself in
  the app switcher. Switch it off in Settings.
- **Offline:** shows your last feed and Saved with a note saying why (offline, or Tailscale off).
- **Accessibility:** larger text sizes, VoiceOver labels, Reduce Motion.
- **For checking speed:** Settings > Developer > Performance readout.

What a free Apple ID means: the app has to be signed again every 7 days (Sideloadly, or AltStore
to do it for you), and it can't receive push notifications; alerts keep coming through ntfy and
Telegram. The paid developer account would lift both (see the end of `docs/ios-sideload.md`).

## Fixed
- **"Size must match" on hunts.** A hunt kept every match it ever found, so turning the switch on
  (or lowering the price, or changing sizes) left old wrong-size matches listed: your Yeezy hunt
  showed sizes 13, 11.5 and 9.5 for UK 9. Matches are now re-checked whenever you edit a hunt
  and on every run. On the live server this removed 29 of its 33 matches, leaving the 4 real
  size 9s.

## Behind the scenes
- **App login:** the server issues the app a token (kept in the iPhone's Keychain) with the same
  protections as the web login: shared rate limits, "log out everywhere" and password changes
  end it. The web login is unchanged.
- **Shared code:** types, the API client and the pure logic now live in `shared/`, used by both
  apps, with their tests.
- **Builds:** a manual GitHub Actions workflow builds the app on a Mac in the cloud. Your licensed
  font and icon files reach it only through encrypted secrets, and the result is uploaded
  password-protected for one day, since the repo is public.
- Tests: 244 backend, 59 web, 103 shared, 48 iPhone app.

## Setup changes
- Rebuild the API and worker (done on 17 November) for the app login and the hunt fix.
- For the iPhone app: the secrets and steps in `docs/ios-sideload.md`.
- Neue Montreal in an app needs Pangram's **App licence** (the web uses the font under its own
  licence).

## Known limits
- No push notifications in the app with a free Apple ID; re-signing every 7 days.
- `npx expo start --web` is not a target (Keychain and SQLite don't exist on the web); use the
  web app.
- Scrolling smoothness was judged by eye on the iPhone; the performance readout is there for
  numbers.
