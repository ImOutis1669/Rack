---
name: rack-apple-design
description: Rack's design skill - an iOS 26-clean look for a Safari home-screen web app. Combines Apple's fluid-motion and materials principles translated for the web (springs, interruptibility, translucency, typography) with iOS 26 specifics (Liquid Glass rules, capsule shapes, scroll edge effects, SF optical sizes and Dynamic Type, grouped lists, sheets) and a list of tells that make an app look generated. Use for any UI, motion or styling change in frontend/, before editing AppShell, sheets, tiles, lists or tokens.
---

# Rack Apple design

Rack is used daily as an iPhone home-screen web app (Safari/WebKit is the main target) and in a
desktop browser. It should feel like a calm, native iOS 26 app where the clothes are the
interface and the chrome stays quiet. `DESIGN.md` in the repo root holds Rack's actual tokens and
decisions; this skill is the reasoning behind them.

## How to use it

1. **Before UI work,** read `DESIGN.md`, then the parts of this skill that apply:
   - `motion-and-materials.md`: Apple's principles for the web (Emil Kowalski's `apple-design`):
     respond on press, springs over timed animations, interruptibility, velocity hand-off,
     materials and depth, reduced motion, typography craft, the eight design principles.
   - `ios26-reference.md`: iOS 26 specifics, translated from SwiftUI to CSS: Liquid Glass rules
     and a Safari-safe glass recipe, shapes, scroll edge effects, SF text styles and Dynamic Type,
     touch targets, grouped lists, sheets.
   - `tells.md`: patterns that make an app look generated. Check every change against it.
2. **Where they overlap,** iOS 26 rules decide *what* things look like (shape, material, type
   scale); the motion guide decides *how* they move and respond.
3. **Web reality wins over Swift APIs.** If a rule needs something Safari can't do (refraction,
   system lensing, haptics on iOS web), use the nearest honest approximation and note it.

## Defaults for Rack (the short version)

**Material**
- Glass only on navigation chrome: the floating tab dock, the top bar, overlay buttons on photos.
  Never on content, never glass on glass.
- One `backdrop-filter` layer per glass surface (blur + saturate), plus a specular top line, a
  bright rim and a soft shadow drawn with gradients and `box-shadow`. No SVG filters.
- Soft scroll-edge fades where chrome overlaps content, not hairline dividers.
- `prefers-reduced-transparency` → solid; `prefers-contrast: more` → solid with an edge.

**Motion** (Motion library)
- Default spring: `{ type: "spring", bounce: 0, duration: 0.35 }` (critically damped).
- Sheets and anything thrown by a gesture: `bounce: 0.2, duration: 0.3`, and hand off the
  release velocity.
- Moving selection (active tab pill, segmented control): shared layout animation with the
  default spring, starting from the current position so it can be interrupted.
- Press feedback on pointer-down: `scale(0.97)` at 100ms. Never wait for click to respond.
- `prefers-reduced-motion`: cross-fade instead of slide/spring; no overshoot.

**Type**
- System font stack (SF on Apple devices), sizes in `rem`, tabular numbers for prices.
- iOS text styles as the scale (Body 17, Subheadline 15, Footnote 13, Caption 12/11, Title 3 20,
  Large Title 34); tighten tracking as size grows.

**Shape and touch**
- Capsules for controls and the dock, concentric radii for nested containers.
- 44px minimum targets; grouped inset lists with hairlines; chevrons only for navigation.
- Sheets: grabber, spring in from their source, close along the same path.

**Copy**
- Plain and short. No em dashes, no exclamation marks, no greetings.

## Before you finish a UI change

- Looks right at 375×812 in light and dark, and on desktop.
- Every new animation is interruptible and has a reduced-motion version.
- No new glass on content; no glass on glass; no new gradients as decoration.
- Nothing from `tells.md`.
