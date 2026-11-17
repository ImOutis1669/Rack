# Owner-only assets (never committed)

Licensed files that only the owner's account may load (v2.1: friends get the system font and
lucide icons). Everything here except this README is git-ignored. The Docker image copies the
folder to `/app/private`, and the API serves it only to the owner, after login:
`/api/owner-assets/fonts/<file>` and `/api/owner-assets/icons.json`. It is never part of the
public web bundle.

- `fonts/neuemontreal-{regular,medium,bold}.otf`: your own Neue Montreal files (Pangram
  Pangram, personal-use licence).
- `basil.json`: Basil Icons path data, written by `npm run icons -- "<pack>/svg"` from your own
  Craftwork pack.

The iOS app's `npm run private-assets` reads the same files.
