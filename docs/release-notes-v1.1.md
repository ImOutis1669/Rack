# Rack v1.1

Released 16 November 2026. Covers `docs/v1.1-brief.md` (features 1–6) and the parts of
`docs/v1.2-brief.md` that were folded into this release. OLED mode was dropped.

## New
- **eBay is live.** Production keys, UK delivery only, men's only. Each new listing is looked up
  once for its size and brand; until then the size is read from the title. The Sources sheet shows
  today's eBay usage against the 5,000-a-day limit (about 700 a day at the 30-minute refresh).
- **Share** a listing's marketplace link from its sheet: the iOS share sheet, or copy with a
  "Link copied" toast. A grouped listing offers one link per marketplace.
- **I bought it** on Saved items: asks for the price paid, moves the item into your wardrobe with
  its photo, title, source, link, brand, size and date, and stops its price alerts. Undo puts it
  back in Saved exactly as it was.
- **Wardrobe value:**
  - your price paid and your own value, with a total and the change;
  - an estimated resale value from similar items: the median **Grailed sold price** when there
    are 5+ similar sales in 90 days, else the median asking price of live listings, with how many
    it's based on;
  - a rising/falling **sold-price trend** over 30 and 90 days with a sparkline, shown only when
    there are enough sales.
- **Hunts: "Size must match".** Listings without your size are skipped. Sizes now match across
  formats: UK, EU and US shoe sizes (UK 9 = EU 43, within half a size across systems) and W32 = 32.

## Design
- A project design skill (`.claude/skills/rack-apple-design`) combining Apple's web-ready motion
  and materials guidance, the iOS 26 rules (Liquid Glass, Dynamic Type) and a list of "generated
  app" tells. `DESIGN.md` points to it.
- **Liquid Glass** tab dock and top bar: one blur layer with a specular edge, a bright rim and a
  soft shadow; the active tab's pill slides with a spring; a soft scroll edge replaces the divider
  line. Solid fallbacks for Reduce Transparency and Increase Contrast.
- **Upvote/downvote arrows** instead of thumbs (green up, red down).
- The feed is titled **Rack**.
- **Minimal Wardrobe:** feed-style tiles (photo, brand, name, value, trend). Tapping a tile opens
  a sheet with everything about the item, an edit mode, and delete (or move back to Saved).
- Sheets use the design skill's spring.

## Faster
Measured in `docs/perf-v1.1.md`. First screen on a 3× iPhone, before → after:

| | Before | After |
|---|---|---|
| Tile photos | 1.96 MB | 506 kB |
| JavaScript downloaded | 520 kB (uncompressed) | 128 kB (+32 kB after start) |
| Feed API, first page | 41 kB | 7 kB |
| Tiles in the page with ~430 loaded | ~430 | 26 |

- Cached WebP thumbnails for tiles; full-size photos only in the listing sheet.
- The last feed and Saved list show instantly on open (kept 24 hours, cleared on sign-out).
- A virtualized masonry grid; the scroll position is kept when you switch tabs.
- Listing details load when you touch a tile (or as it appears, except Vinted).
- Pages and sheets load on first use; Motion loads its animation features after startup.
- The server now compresses text and caches hashed files permanently (it sent everything
  uncompressed before).
- `?perf=1` shows timings and scroll smoothness on the device.

## Privacy
- **No eBay user data is stored** (Rack's eBay "I do not persist eBay data" exemption): no seller
  names, feedback, or item city/postcode; the stored raw data is an allow-list of item fields;
  a second check at the database boundary; eBay listings are deleted 7 days after they're last
  seen or as soon as they're gone; "Hide seller" is disabled for eBay. Test data never contains
  real eBay listings.
- Grailed sold prices are stored as item data only (never the seller), for 200 days.
- Thumbnails (eBay photos included) are deleted after 7 days.

## Migrations
0008 (clean existing eBay rows) · 0009 (excluded listings) · 0010 (bought items) · 0011 (custom
value) · 0012 (resale estimates) · 0013 (sold listings, estimate snapshots, trends) · 0014 (hunt
strict size) · 0015 (item name, purchase date, category). All run automatically when the API
starts.

## Known limits
- Estimates and trends use Grailed sales (mostly US, converted to £) or asking prices; treat them
  as rough. Brands Rack doesn't search, or with few Grailed sales, get no estimate.
- The resale photo-similarity threshold (0.65) was tuned on one real item.
- On this PC, Windows reports "reduce transparency", so the desktop app shows the solid version
  of the glass bars; the iPhone shows the glass.
- The iPhone "after" performance measurement wasn't taken; the iPhone baseline is in
  `docs/perf-v1.1.md`.
