<!-- iOS 26 design rules condensed from rshankras/claude-code-apple-skills `design/liquid-glass`
     and `design/typography` (MIT, (c) 2025 Ravishankar), translated from SwiftUI to the web for
     Rack. See LICENSE-NOTICES.md. -->

# iOS 26 reference, for a Safari web app

Apple's rules come from SwiftUI, where the system draws the glass. On the web we draw it
ourselves, so each rule below says what it means in CSS.

## Liquid Glass: the rules (WWDC25)

Liquid Glass is the material of the **navigation layer** (bars, toolbars, floating controls),
never the content layer (lists, rows, cards, photos).

| Rule | What it means in Rack |
|---|---|
| **Never glass on glass** | Nothing glass sits on glass. Controls inside the dock or top bar use fills and vibrancy-style text, not another `backdrop-filter`. |
| **Two variants, never mixed** | *Regular* (adaptive, works over anything) is the default. *Clear* only over media with bright content on top and a dim layer acceptable. Rack uses Regular everywhere. |
| **Tint only primary actions** | "When every element is tinted, nothing stands out." The accent goes on the active tab and the one primary action, not on the whole bar. |
| **No steady-state intersections** | At rest, content shouldn't sit half under a glass element: pad scroll content so the last row clears the dock. |
| **Strip decorated bars** | No custom borders or backgrounds on bars. Hierarchy comes from grouping and layout. Never group an icon with a text label inside one toolbar group. |

**Scroll edge effects** separate floating bars from content. iOS uses a *soft* edge (a gradual
fade) by default; a *hard* edge (denser, with a dividing line) is mostly macOS. One per edge,
and only where a floating element actually overlaps content. On the web: a short
`mask-image`/gradient fade under the top bar and above the dock, **not** a 1px hairline.

**Shapes:** capsule (radius = half the height) for phone-scale controls, with extra margin from
the screen edge; concentric radii for nested containers (inner radius = outer radius − padding).

**Accessibility is part of the material:** Reduce Motion removes elastic and lensing effects;
Increase Contrast renders glass solid black/white with a contrasting border. On the web:
`prefers-reduced-motion`, `prefers-contrast: more` and `prefers-reduced-transparency` (see the
recipe below).

**Tab bars** in iOS 26 float above content as a glass capsule; the selected tab sits on a glass
pill that moves between tabs. Bars can recede while scrolling down (`tabBarMinimizeBehavior`);
optional, not required. **Sheets** carry the glass material and morph from their source; don't
paint opaque custom sheet backgrounds over it.

### Safari-safe glass recipe

Safari has no SVG displacement filters in `backdrop-filter`, so true refraction isn't possible:
they would silently fall back to plain blur on iPhone. Build the look from one blur layer plus
cheap highlights:

```css
.glass-chrome {
  /* the only backdrop-filter: one layer, never nested */
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  background: var(--glass);                       /* translucent: content tints it */
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.55),        /* specular line along the top edge */
    inset 0 0 0 1px rgb(255 255 255 / 0.16),      /* bright rim: reads as thick glass */
    0 8px 32px rgb(0 0 0 / 0.18);                 /* soft drop shadow */
}
.glass-chrome::before {                           /* soft specular sheen, no extra blur */
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(to bottom, rgb(255 255 255 / 0.22), transparent 45%);
}
@media (prefers-reduced-transparency: reduce) {   /* frostier/solid */
  .glass-chrome { background: var(--surface); backdrop-filter: none; -webkit-backdrop-filter: none; }
}
@media (prefers-contrast: more) {                 /* solid with a defined edge */
  .glass-chrome { background: var(--background); box-shadow: 0 0 0 1px var(--foreground); }
}
```

Dark mode needs its own values (a dimmer sheen and rim), chosen and checked, not inverted.

## Typography: SF and Dynamic Type

- **Optical sizes:** San Francisco blends its Text and Display designs between **17 and 28pt**.
  The system font stack (`-apple-system, BlinkMacSystemFont, "SF Pro Text"…`) gets this for free
  on Apple devices; never bundle SF files (Apple's licence).
- **Tracking is size-specific,** never one value: tighter on large display text, slightly looser
  on small text. Prefer wrapping to truncating for text that matters.
- **Text styles first:** build hierarchy from 2–3 styles plus an emphasized weight before adding
  sizes. iOS default (Large) sizes, pt = CSS px at 1×:

| Style | Size / leading | Weight |
|---|---|---|
| Large Title | 34 / 41 | regular (bold for page titles) |
| Title 1 | 28 / 34 | regular |
| Title 2 | 22 / 28 | regular |
| Title 3 | 20 / 25 | regular |
| Headline | 17 / 22 | semibold |
| Body | 17 / 22 | regular |
| Callout | 16 / 21 | regular |
| Subheadline | 15 / 20 | regular |
| Footnote | 13 / 18 | regular |
| Caption 1 | 12 / 16 | regular |
| Caption 2 | 11 / 13 | regular |

- **Dynamic Type has 12 sizes** (7 default + 5 accessibility); Body goes from 17pt up to 53pt
  at AX5. On the web, Safari exposes the user's setting through
  `font: -apple-system-body` (and `-apple-system-headline`, `-apple-system-footnote`…). Setting
  it on `html` makes `rem` follow Dynamic Type; size everything in `rem`/`em` so layouts scale,
  and let rows grow rather than clip.

## Touch, lists, sheets

- **Touch targets** at least 44×44pt, with hit padding beyond small glyphs.
- **Grouped (inset) lists:** rows at least 44pt, hairline separators inset from the leading
  edge, sections on `surface` with rounded corners, destructive actions last and in red.
- **Chevrons** only on rows that push to another screen.
- **Sheets:** grabber at the top, detents (medium/large) on phone, spring in from the source,
  dismiss along the same path.
