# Private assets (never committed)

The iOS app uses the owner's own licensed files, which must not be published in this public repo:

- `fonts/neuemontreal-{regular,medium,bold}.otf`: Neue Montreal (Pangram Pangram). Embedding
  it in an app needs Pangram's App licence.
- `basil.json` and `bars/*.png`: Basil Icons (Craftwork) as path data (drawn with
  react-native-svg) and as images for the native tab bar and header buttons.
- `index.ts`: the manifest the app imports as `@rack/private`.

Build them with `npm run private-assets` (in `mobile/`). By default it reads the web app's
owner-only `frontend/private/fonts/` and `frontend/private/basil.json` (made by
`npm run icons` in `frontend/`); pass other paths as arguments.

Everything in this folder except this README is git-ignored. Without the files the app falls back
to SF Pro and SF Symbols. The GitHub Actions build gets them from an encrypted repository secret
and encrypts the `.ipa` it uploads, because artifacts of a public repo can be downloaded by any
GitHub user (set up in iOS step 9).
