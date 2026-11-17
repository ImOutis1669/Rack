# Private assets (never committed)

The iOS app uses the owner's own licensed files, which must not be published in this public repo:

- `fonts/neuemontreal-{regular,medium,bold}.otf`: Neue Montreal (Pangram Pangram). Embedding
  it in an app needs Pangram's App licence.
- Basil Icons (Craftwork): the app reads the same generated path data as the web app
  (`frontend/src/components/icons/basil.generated.ts`, made by `npm run icons` in `frontend/`).

Everything in this folder except this README is git-ignored. Without the files the app falls back
to SF Pro and SF Symbols. The GitHub Actions build gets them from an encrypted repository secret
and encrypts the `.ipa` it uploads, because artifacts of a public repo can be downloaded by any
GitHub user (set up in iOS step 9).
