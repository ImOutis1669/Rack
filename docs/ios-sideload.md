# Installing Rack on your iPhone (sideloading)

Rack's iOS app is built in the cloud by GitHub Actions (there's no Mac) as an **unsigned
`.ipa`**. Sideloadly then signs it with your free Apple ID and installs it over USB.
With a free Apple ID the app runs for **7 days** before it has to be signed again.

Rules checked on 17 November 2026; Apple and the tools change them, so check
[Sideloadly's FAQ](https://sideloadly.io/faq) if a step no longer matches.

## 1. One-time set-up: secrets on GitHub

The repo is public, so nothing private goes into it. The build reads these **repository
secrets** (GitHub > the repo > Settings > Secrets and variables > Actions > New repository
secret):

| Secret | What to put in it |
|---|---|
| `RACK_IPA_PASSWORD` | A long password (12+ characters) you keep in your password manager. The built app is only ever uploaded inside a 7z encrypted with it (AES-256, file names hidden), because the app contains your Neue Montreal and Basil files and anyone can download a public repo's build files. |
| `RACK_URL` | Your server, e.g. `https://your-pc.your-tailnet.ts.net` (your `RACK_PUBLIC_URL`). Optional: without it you type it on the login screen. |
| `RACK_ASSETS_1`, `RACK_ASSETS_2`, ... | Your font and icon files, packed (below). Optional: without them the app uses SF Pro and SF Symbols. |

To make the `RACK_ASSETS_*` values, on this PC:

```bash
cd mobile
npm run private-assets   # your Neue Montreal + Basil files -> assets/private
npm run pack-secrets     # -> mobile/.ci-secrets/RACK_ASSETS_1.txt, _2.txt, ... (git-ignored)
```

Paste the whole content of each `RACK_ASSETS_N.txt` into the secret of the same name. A secret
holds at most 48 KB, which is why there are several (4 today). If you ever have fewer files
than before, delete the extra secrets. With the GitHub CLI instead of the website:
`gh secret set RACK_ASSETS_1 < mobile/.ci-secrets/RACK_ASSETS_1.txt` (and so on).

Pangram's licence for an app needs the **App licence** for Neue Montreal; Craftwork's licence
covers Basil inside a finished app. Neither file is ever committed.

## 2. Build

1. GitHub > the repo > **Actions** > **iOS build (unsigned .ipa)** > **Run workflow**
   (branch `main`). It takes about 20 to 30 minutes on a free macOS runner (free for public
   repos).
2. When it's green, open the run and download **rack-ios** under Artifacts. It's kept for
   **1 day**.
3. Unzip it, then open `Rack-ios.7z` with [7-Zip](https://www.7-zip.org) and enter your
   `RACK_IPA_PASSWORD`. You get `Rack.ipa`. Keep it off shared folders (it contains your
   licensed files).

## 3. Install with Sideloadly (Windows)

1. Install **iTunes** and **iCloud** from Apple's website, not the Microsoft Store versions
   (Sideloadly needs the web installers). Open iTunes once.
2. Install **Sideloadly** from [sideloadly.io](https://sideloadly.io).
3. Connect the iPhone with a cable, unlock it and tap **Trust** on the phone.
4. Drag `Rack.ipa` into Sideloadly, enter your Apple ID, press **Start**, and type the
   two-factor code Apple sends. Sideloadly sends the login to Apple and doesn't store it. You
   can use a separate Apple ID just for sideloading if you prefer.
5. On the iPhone, once:
   - **Settings > Privacy & Security > Developer Mode**: turn it on, restart, confirm.
   - **Settings > General > VPN & Device Management**: tap your Apple ID under Developer App,
     then **Trust**.
6. Open Rack. Tailscale must be on for it to reach your server.

## 4. Every 7 days

The free signature expires after 7 days (the app then won't open; your data stays). Sign it
again with **the same Apple ID**: in Sideloadly, drag the same (or a newer) `Rack.ipa` in and
press Start. That replaces the app and keeps its data, including your login.

To renew automatically instead, [AltStore](https://altstore.io) (AltServer running on this PC,
phone on the same Wi-Fi) or SideStore re-sign in the background. A free Apple ID allows 3
sideloaded apps at a time; AltStore/SideStore counts as one of them.

## 5. Updating

Run the workflow again, download, and sideload the new `Rack.ipa` over the old one with the
same Apple ID.

## What changes with the paid Apple developer account ($99/year)

Nothing here depends on it; this is what it would add:

- **Signing for a year** instead of 7 days, and no 3-app limit.
- **TestFlight:** the workflow would sign and upload builds (a signing certificate and an App
  Store Connect API key as secrets, or EAS Build); TestFlight then installs and updates Rack
  over the air, no cable, no weekly re-signing.
- **Push notifications through APNs:** the app would register for notifications
  (`expo-notifications`) and the server would get an APNs channel next to ntfy, Telegram and
  Web Push (an APNs `.p8` key in `.env.worker`). Until then alerts keep coming through
  ntfy / Telegram.
- Optional: binding the Keychain token to Face ID at the Keychain level. Today the app's own
  Face ID lock guards it (with a passcode fallback).
