# Performance, v1.1

Measured at iPhone size (375×812). "Pane" = the Claude desktop browser pane on the dev PC (it
doesn't draw frames, so scroll smoothness is measured on the iPhone with `?perf=1`).

## Baseline (before any change), 2026-11-16

| Measure | Value | How |
|---|---|---|
| JS bundle | 520 kB (167 kB gzip), one chunk | `vite build` |
| CSS | 37 kB (7.8 kB gzip) | `vite build` |
| Feed API, first page | 94 ms, 41 kB | pane, Resource Timing |
| First tile in the page (warm) | 207 ms | pane, `?perf=1` |
| First photo loaded (warm, photos cached) | 210 ms | pane, `?perf=1` |
| Photos requested for the first screen | 8 | pane |
| Bytes of those 8 photos | **1.96 MB** (78–813 kB each; full-size eBay `s-l1600` and Grailed originals for ~180 px tiles) | downloaded from the worker container |
| iPhone: first tile (cold, Safari over Tailscale) | **439 ms** | `?perf=1` on the phone |
| iPhone: first photo (cold) | **1,061 ms** | `?perf=1` |
| iPhone: scroll with 120 tiles loaded | **62 fps**, median 17 ms, p95 23 ms, 1 of 114 frames dropped | `?perf=1`, steady scroll |

## Step 1: thumbnails (382f56a + 640 px size)

| Measure | Before | After | How |
|---|---|---|---|
| First-screen photos, 1× screen (480 px) | 1.96 MB | **310 kB (−84%)** | pane, Resource Timing |
| First-screen photos, 3× iPhone (640 px) | 1.96 MB | **506 kB (−74%)** | same 8 photos at w=640 |
| (960 px versions, for comparison) | | 713 kB | before the 640 px size was added |
| First photo, warm (thumbnails cached) | 210 ms | 154 ms | pane, `?perf=1` |
| First photo, first ever view of a photo | | 330–1,250 ms | the thumbnail is made on that request, then cached |
| iPhone: first tile / first photo / scroll | 439 / 1,061 ms, 62 fps | to measure | `?perf=1` |

## Step 2: instant start

The feed's cache key includes the visit start time (it changes every open), so TanStack Query's
persistence would never match. Instead the first page of the default feed and the Saved list are
kept as a small snapshot (`lib/snapshot.ts`, localStorage, 24 h, cleared on logout / log out
everywhere / any 401) and shown as placeholder data while fresh results load. No new dependency.

| Measure | Before | After | How |
|---|---|---|---|
| First tile, warm reload | 152–207 ms | **71 ms** (fresh feed arrives at 206 ms) | pane, `?perf=1` |
| Snapshot size | | 35 kB | localStorage |

## Step 3: virtualized masonry grid

`components/VirtualGrid.tsx` (`@tanstack/react-virtual` 3.14.24, window scrolling, shortest-column
masonry, tiles measured once rendered) for the feed and Saved. Note for testing in the pane: it
draws no frames, so the browser fires no `scroll` events there; tests dispatch them by hand.

| Measure | Before | After | How |
|---|---|---|---|
| Tiles in the page after ~430 loaded (15 pages) | ~430 (every tile stays) | **26** | pane, `[data-tile]` count |
| Coming back to the feed from another tab | top of the feed | **same position** (25,000 px → 25,000 px, same tiles) | pane |
| Infinite scroll | yes | yes (loads ~4 rows before the end) | pane |

## Step 4: prefetch

- Next feed page: requested ~6 rows (about two phone screens) before the end (was 4 rows).
- Listing details: prefetched when a tile appears for eBay/Grailed/Vestiaire (served from Rack's
  database), and on touch for every source; Vinted waits for a touch because its details fetch
  the item page from vinted.co.uk. A touch also starts loading the full-size first photo.

| Measure | Before | After | How |
|---|---|---|---|
| Details request on opening a listing | starts when the sheet opens | **already done** when it opens (started on touch, 40 ms) and not repeated | pane, Resource Timing |
| Prefetch when a tile appears | | not observable in the pane (no visibility checks without drawing); check on the iPhone | |

## Step 5: trim

- Pages other than the feed (Wardrobe, Saved, Hunts, Settings, Login) and the listing and
  "I bought it" sheets load on first use (`React.lazy`).
- Motion: `LazyMotion` + `m` elements; its animation features (incl. layout, for the tab pill)
  load as their own chunk after startup.
- Unused Magic UI components removed (`animated-shiny-text`, `progressive-blur`).
- lucide-react is imported per icon (already tree-shaken: 23 kB of source in the bundle).
- Found while measuring: the server sent everything **uncompressed**, and hashed assets had no
  long cache header. Now gzip for text (not photos), `immutable` for `/assets/*`, `no-cache` for
  the app shell.

| Measure | Baseline | After step 3 | After step 5 | How |
|---|---|---|---|---|
| Main JS, minified | 520 kB | 560 kB | **393 kB** | `vite build` |
| Main JS, over the wire | 520 kB (uncompressed) | 560 kB | **128 kB** (+32 kB motion features after start) | Resource Timing |
| Feed API first page, over the wire | 41 kB | 35 kB | **7 kB** | Resource Timing |
| First tile, warm | 207 ms | 71 ms (from snapshot) | 143 ms (this run) | pane, `?perf=1` |
