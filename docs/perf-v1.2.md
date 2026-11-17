# Rack v1.2: sharper photos (feature 5)

Measured 2026-11-17 on the live data (Docker on the gaming PC), 640 px thumbnails: the size an
iPhone requests for a 2-column tile at 3x. Compare with `docs/perf-v1.1.md`.

## Root cause
eBay's Browse API **search** returns each photo as `…/images/g/<id>/s-l225.jpg` (225 × 225).
**getItem** returns the same photo id as `s-l1600`. Live probe (1 search + 1 getItem):

| eBay CDN variant of one photo | Bytes | Pixels |
|---|---|---|
| `s-l225` (what search gave us) | 6.7 kB | 225 × 225 |
| `s-l500` | 19.8 kB | 500 × 500 |
| `s-l960` | 54 kB | 960 × 960 |
| `s-l1600` (what getItem gives) | 131 kB | 1600 × 1600 |

Before the fix, 16,994 of 17,691 eBay photo rows were `s-l225`. A second bug made it worse:
after getItem stored the `s-l1600` gallery, the next search refresh had a different first URL,
so `set_images` replaced the gallery with the small photos again and dropped their embeddings.

## Fix
- `sources/ebay.py`: `full_size_image()` stores every eBay CDN photo as `s-l1600`, the form
  getItem itself returns, so search and getItem agree and refreshes keep the same rows.
- Migration 0016 rewrote all 17,691 eBay rows to `s-l1600` (embeddings/pHash kept: same photo),
  merged rows that had both sizes, and deleted the old cached thumbnails.
- Tile URLs carry `v=<settings version>.<hash of the photo URL>` (`lib/thumbs.ts`), so the
  iPhone's week-long immutable cache can't keep showing the blurry version.

## Thumbnail settings: quality for size
SSIM (luma, against a lossless Lanczos 640 px reference; 1.0 = identical) and total bytes,
32 recent photos across the sources. `docker compose exec api python - < thumb_study.py`.

| Source (photos) | Setting | Total | Mean SSIM | Worst SSIM | Encode |
|---|---|---|---|---|---|
| eBay (16) | **before**: `s-l225` → WebP 78 | 6.7 kB median | **0.910** | | |
| eBay (16) | `s-l1600` → WebP 78 | 314 kB | 0.982 | 0.947 | 13 ms |
| eBay (16) | WebP 85 | 425 kB | 0.988 | 0.969 | 15 ms |
| eBay (16) | AVIF 60 | 282 kB | 0.984 | 0.939 | 28 ms |
| eBay (16) | **AVIF 70** | 387 kB | **0.989** | 0.963 | 27 ms |
| Vinted (10) | WebP 78 (v1.1) | 456 kB | 0.962 | 0.929 | 27 ms |
| Vinted (10) | WebP 85 | 627 kB | 0.975 | 0.965 | 29 ms |
| Vinted (10) | AVIF 60 | 395 kB | 0.968 | 0.937 | 50 ms |
| Vinted (10) | **AVIF 70** | 542 kB | **0.978** | 0.962 | 53 ms |
| Grailed (6) | WebP 78 (v1.1) | 337 kB | 0.961 | 0.949 | 30 ms |
| Grailed (6) | WebP 85 | 460 kB | 0.974 | 0.968 | 33 ms |
| Grailed (6) | AVIF 60 | 275 kB | 0.959 | 0.939 | 54 ms |
| Grailed (6) | **AVIF 70** | 389 kB | **0.973** | 0.963 | 60 ms |

Chosen: **AVIF quality 70** for browsers that send `image/avif` in `Accept` (Safari since
iOS 16, Chrome, Firefox), **WebP 85** otherwise (`Vary: Accept`). AVIF 70 matches WebP 85's
quality for 13–15% fewer bytes and is clearly sharper than v1.1's WebP 78; encoding is paid
once per photo (thumbnails are cached). Resampling stays Lanczos, widths 480/640/960.

## Before / after (same image ids, 640 px)

| Measure | v1.1 | Before (v1.2 start) | After, iPhone (AVIF 70) | After, no-AVIF browser (WebP 85) |
|---|---|---|---|---|
| Default feed, first 8 tiles (Vinted/Grailed today) | 506 kB | 451 kB | **521 kB** (+15%) | 625 kB |
| 12 newest eBay tiles | | 55 kB (blurry) | **444 kB** (10–92 kB each) | 518 kB |

The first screen stays within 3% of v1.1's 506 kB (v1.1 baseline before thumbnails: 1.96 MB),
so the v1.1 performance gains hold. eBay tiles now cost about the same as Vinted and Grailed
tiles because they finally carry real detail; a few sellers' originals are only 500–600 px.

Side-by-side at iPhone tile size (516 px = ~172 pt at 3x): `ebay-before-after.png`, made with
`side_by_side.py` (not in the repo: it shows marketplace photos).
