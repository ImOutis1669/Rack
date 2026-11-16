# Rack design

The source of truth for UI decisions. Read this before changing the frontend.

## Design reference
From v1.1 (2026-11-16) all UI work follows the project skill
**`.claude/skills/rack-apple-design`**, which the user chose to build from the best of both
candidates:
- Emil Kowalski's web-first `apple-design` (motion, springs, materials, typography craft);
- the iOS 26 rules from `claude-code-apple-skills` (Liquid Glass, shapes, scroll edge effects,
  SF text styles and Dynamic Type), translated from SwiftUI to CSS;
- the "tells" catalogue from `mobile-taste-skill`, adapted for the web.

Where this file and the skill disagree, the skill wins unless a decision below says otherwise.
The open conflicts with the v1.0 design are listed at the end of this file.

## App read
A personal second-hand fashion finder for one person, used daily on an iPhone (installed to the
home screen) and a Windows PC. The language is calm, photo-first and Apple-native: the
clothes are the interface, and the chrome stays quiet.
- **Platforms:** iPhone (PWA, standalone) first-class, desktop browser first-class.
- **Posture:** unified brand with Apple-style chrome.
- **Dials:** expression 5 (branded content, native-feeling chrome), motion 4, density 3.

## Navigation
**Tabs (4):** Feed · Hunts · Saved · Wardrobe.
- On iPhone they're a bottom glass tab bar; on desktop a segmented control in the top glass bar.
- Settings sits behind the gear in the header, not in a tab.

| Surface | Kind |
|---|---|
| Listing detail | Full-screen sheet on phone, centred modal on desktop, with an explicit close button |
| Filters | Bottom sheet |
| New/edit hunt | Sheet |
| Add to wardrobe | Sheet |
| Sources | Sheet, from the status dot in the header |

## Tokens (`frontend/src/index.css`)
Semantic colours only, so light and dark both work and follow the system:

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | #FFFFFF | #000000 (deliberate, OLED) | page |
| `surface` | #F2F2F7 | #1C1C1E | grouped sections, inputs, sheets |
| `elevated` | #FFFFFF | #2C2C2E | rows inside grouped sections, menus |
| `foreground` | #111113 | #FFFFFF | primary text |
| `muted` | 60% grey | 60% grey | secondary text |
| `subtle` | 30% grey | 30% grey | tertiary text, placeholders |
| `border` | hairline grey | hairline grey | separators |
| `fill` | 12% grey | 24% grey | chips, icon buttons |
| `accent` | #248A3D | #30D158 | the one accent: match score, "good for you" signals (price cut, new, fit OK) |
| `danger` | #D70015 | #FF453A | destructive actions only |
| `warning` | #B25000 | #FFB340 | estimates and caveats (delivered cost) |

Primary buttons are monochrome (foreground on background, inverted), like a fashion retailer.
There are no gradients, and no indigo.

## Type
SF Pro everywhere it exists, through the system font stack (`--font-sans`):
- **iPhone, Mac:** get SF through `-apple-system`, with automatic optical sizes.
- **Windows:** gets SF Pro only if it's installed locally; otherwise Segoe UI. Font files are
  never bundled or served (Apple's licence).

| Role | Size | Weight | Use |
|---|---|---|---|
| Large title | 32 | bold | page titles |
| Title | 20 | semibold | sheet titles |
| Headline | 15 | semibold | prices |
| Body | 15 | regular | text; 16 for inputs, so iOS doesn't zoom on focus |
| Footnote | 13 | regular | |
| Caption | 11 | regular | |

Use tabular figures for prices and numbers.

## Shape and spacing
- **Radii:** 12 for photos, inputs and rows; 16 for grouped sections; 24 for sheets; capsule
  for buttons, chips and the tab bar.
- **Spacing:** the 4/8 scale, with 16px side gutters on phone and 24px on desktop.
- **Touch targets:** at least 44px.
- **Separators:** hairlines rather than boxes. A listing is a photo with text under it, never a
  bordered card.

## Glass
Glass is for the navigation layer only (top bar, tab bar, overlay buttons on photos), never on
content, and never glass on glass.

**Liquid Glass chrome** (`glass-chrome` for the dock, `glass-bar` for the top bar, tokens
`--chrome*` in `index.css`): one `backdrop-filter: blur(24px) saturate(180%)` layer over a
translucent `--chrome` fill so content tints it, plus a specular top line and sheen (gradient),
a bright inner rim and a soft drop shadow (`box-shadow`). Light and dark have their own values.
No SVG refraction filters (Safari ignores them in `backdrop-filter`). The top bar has no hairline:
a soft scroll-edge fade appears under it once content scrolls beneath (`data-scrolled`).
`prefers-reduced-transparency` makes both solid (`surface`); `prefers-contrast: more` makes them
solid with a 1px edge. Note: this PC's browser reports reduced transparency, so the desktop app
shows the solid version here.

**Active tab:** a plain fill pill (not glass) that slides between tabs with the default spring
(`lib/motion.ts`, `bounce 0, 0.35s`), instant with reduced motion. Same on the desktop segmented
control. Small overlays on photos still use the plain `glass` utility. On phones the floating tab bar sits on a solid-to-transparent gradient of the page
background that runs to the bottom edge, so content fades out under it. No blur band: a partial
blur strip with sharp content below it looked messy on iPhone.

## Motion
- **Press feedback:** `active:scale-[0.97]` on everything tappable.
- **Feed entrance:** Magic UI `BlurFade`, on the first screenful of tiles only, so items don't
  replay while scrolling.
- **Score:** Magic UI `AnimatedCircularProgressBar` in the listing detail.
- **Hunt counts:** Magic UI `NumberTicker`.
- **Login:** Magic UI `MagicCard`, with just the name: no slogan anywhere in the app.
- **Reduced motion:** everything respects `prefers-reduced-motion`.

## Icons
One family: `lucide-react`, stroke 1.75, 20px in bars and 18px inline. No emoji as icons.

**Votes** (`components/VoteButtons.tsx`): Reddit-style `ArrowBigUp` / `ArrowBigDown` in one capsule
(`bg-fill` in the sheet, glass on desktop tile hover). Outlined when off; the active arrow fills,
up in `--accent` green and down in `--danger` red. Tapping the active arrow clears the vote.

## Copy
Plain and short. No em dashes in visible strings, no exclamation marks, no "Welcome back".

## Conflicts with the design skill (v1.0 → v1.1)
Found when adopting `rack-apple-design`. Each is fixed when the feature that touches it is built,
and ticked off here.

| # | v1.0 | Skill says | Fix in |
|---|---|---|---|
| 1 | Body and Headline 15px, Large title 32px | iOS text styles: Body 17, Headline 17 semibold, Subheadline 15, Large Title 34 | A type pass: decide with the user (17px body makes the feed less dense) |
| 2 | Fixed sizes; Dynamic Type is ignored | `font: -apple-system-body` on `html` so `rem` follows the iPhone text-size setting | Type pass, together with #1 |
| 3 | ~~Top bar ends in a 1px hairline~~ | Soft scroll-edge fade | **Done** (Liquid Glass) |
| 4 | ~~Tab bar is plain glass with a `ring-border` outline~~ | Liquid Glass with a sliding pill | **Done** (Liquid Glass) |
| 5 | ~~No reduced-transparency / contrast handling~~ | Solid fallbacks | **Done** (Liquid Glass) |
| 6 | Sheet spring `damping 34, stiffness 380`; menus fade in a 0.12s tween | Springs in Apple terms (`bounce`/`duration`): default `bounce 0, 0.35s`, sheets `bounce 0.2, 0.3s`; menus scale from their trigger | When the sheets are restyled (minimal Wardrobe) |
| 7 | Wardrobe tiles carry inputs and buttons | Content tiles are photo + text; editing lives in a sheet | Minimal Wardrobe |

