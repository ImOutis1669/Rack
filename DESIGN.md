# Rack design

The source of truth for UI decisions. Read this before changing the frontend.

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
content. It's built from `backdrop-filter: blur(20px) saturate(180%)` over a translucent
`background`. On phones the floating tab bar sits on a solid-to-transparent gradient of the page
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

## Copy
Plain and short. No em dashes in visible strings, no exclamation marks, no "Welcome back".
