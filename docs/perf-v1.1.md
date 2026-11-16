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
| iPhone: first tile / first photo (cold) | to measure | `?perf=1` on the phone |
| iPhone: scroll after ~300 tiles | to measure | `?perf=1`, scroll 10 s |
