# Rack v1.2

Released 17 November 2026. Covers `docs/v1.2-brief.md` (features 1–7), plus a new icon set, the
login card and five design skills the user added along the way.

## Fixed
- **Top bar on the iPhone.** Two causes, fixed one after the other:
  - Photos scrolling under the bar showed through as a coloured band behind "Rack" and the
    buttons: the bar shared the dock's see-through glass (60% opaque, colours boosted 180%). It
    now has its own, more opaque glass (84% light / 82% dark, mild saturation), and a test keeps
    the title at 7:1 contrast or better over any photo.
  - Safari blurred the bar's own title and icons into its glass while scrolling. The blur now
    lives on a layer behind the bar's content, so text and icons stay sharp.
- **The dock's selection pill slides** between tabs again. The dock (and the desktop tabs) used to
  be rebuilt with every page, so the pill had nothing to slide from; they're now drawn once for
  the whole app and stay put while pages change or load.
- **Sharp eBay photos.** eBay's search hands out every photo at 225 × 225; Rack stored that and
  stretched it over the tiles. eBay's item lookup returns the same photo at 1600 px, so Rack now
  stores that size for every eBay photo (all 17,691 existing rows converted). A second bug went
  with it: a search refresh used to swap a looked-up 1600 px gallery back to 225 px.

## New
- **Swipe down to close** any sheet, like iOS. It follows your finger from the grabber or header,
  and from the content once it's scrolled to the top. A long drag or a quick flick closes it
  (Apple's momentum projection), otherwise it springs back. Photo swipes, pinches, scrolling and
  form fields are left alone; Reduce Motion closes or snaps back without a spring; the close
  button and Escape still work.
- **Accessories** as a category everywhere: feed chip and filter, sizes and budget in Settings,
  hunts, wardrobe items, resale and sold comparables. Searched in each marketplace's own men's
  accessories category: eBay Men's Accessories plus Men's Jewellery (two searches, since eBay
  takes one category per search and jewellery is a separate branch), Grailed's menswear
  accessories, Vinted's Men > Accessories. 708 existing listings moved out of "Any". Accessories
  is switched on in your profile, so loved designers get accessory searches too.
- **Vestiaire Collective removed.** Rack now uses eBay, Vinted and Grailed only. The Apify job,
  its settings, the daily recheck of the blocked site and everything else Vestiaire are gone.

## Design
- **Neue Montreal** (Pangram Pangram) as the app font, from your own font files (see Setup), with
  the system font as the fallback. Medium for semibold labels; numbers keep tabular figures
  (the font has none, so digits come from the system font).
- **Page titles** are 35 px in real Bold, in the same 56 px bar. Faking a heavier weight was tried
  and dropped: both ways looked doubled or blurry on the iPhone.
- **Basil Icons** (Craftwork) from your own copy of the pack: outline at rest, solid when active
  (the selected tab, a saved bookmark), 22 px in bars and the dock. Lucide fills the gaps
  (wardrobe, sources, "⋯", vote arrows and a few inline icons).
- **Login card**: Magic UI's Magic Card in its new "orb" mode, a soft accent glow that follows the
  pointer, in Rack's colours.
- Five MIT design skills in `.claude/skills/` (modular type scale, algorithmic colour palette,
  Emil Kowalski's animate and mobile-native-web, shadcn), under `rack-apple-design`.

## Photos and speed
Measured in `docs/perf-v1.2.md`:

| | Before | After |
|---|---|---|
| eBay tile sharpness (SSIM, 1.0 = perfect) | 0.910 | 0.989 |
| 12 newest eBay tiles, 640 px | 55 kB (blurry) | 444 kB (10–92 kB each) |
| First screen, 8 tiles, 640 px | 451 kB (v1.1: 506 kB) | 521 kB |
| Main JavaScript, gzip | 128 kB (v1.1) | 148 kB (+15 kB is the icon data) |

- Tiles are **AVIF** (quality 70) on the iPhone and other browsers that support it, about as good
  as WebP 85 for 13–15% fewer bytes; others get WebP 85 (was 78).
- Tile addresses carry a version, so a phone can't keep showing an old, blurry thumbnail from its
  week-long cache.

## Setup changes
- **Font:** copy `neuemontreal-regular.otf`, `-medium.otf` and `-bold.otf` from
  pangrampangram.com into `frontend/public/fonts/` and rebuild. They're never committed
  (personal-use licence, public repo); without them Rack uses the system font.
- **Icons:** `cd frontend && npm run icons -- "<unzipped>/Basil Icons/svg"` and rebuild. The icon
  files are never committed (Craftwork's licence forbids sharing them); without them Rack uses
  lucide.
- **Vestiaire:** cancel the Apify actor in your Apify account and delete `APIFY_TOKEN` from
  `.env.worker` (Rack ignores it now).

## Migrations
0016 (eBay photos to full size, old thumbnails deleted) · 0017 (Accessories: rescore everything,
re-sort sold comparables) · 0018 (remove Vestiaire data). All run automatically when the API
starts.

## Known limits
- The font files you supplied came from Befonts, marked "Demo / Trial". They're Pangram's own
  v1.000 files, which Pangram allows for personal use, but swap in the official download.
- The Basil and Neue Montreal versions in use have no heavier weight or tabular figures; titles
  stop at Bold and numbers use the system font's digits.
- Some eBay sellers upload only 500–600 px photos; those can't get sharper.
- About 1,800 listings stay in "Any": mostly perfume, kids' items and titles without a garment word
  ("Rick Owens Vans").
- The browser pane on this PC draws few animation frames and reports "reduce transparency", so the
  sliding pill, the swipe gesture and the glass were checked with recorded positions and on your
  iPhone rather than by eye here.
