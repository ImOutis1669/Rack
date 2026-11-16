<!-- Selected and adapted for a web app from draftbit/mobile-taste-skill
     `_shared/references/tells.md` (MIT, (c) 2026 Draftbit, Inc.). See LICENSE-NOTICES.md. -->

# Tells: things that make an app look generated

Check every change against these. Rack already avoids most; keep it that way.

**Visual**
- **Emoji as icons.** One icon family (`lucide-react`).
- **The indigo pipeline.** Indigo/violet gradients on headers and buttons. No gradients as decoration.
- **Card-stack screens.** Every screen as grey background + white rounded shadowed cards.
  Use whitespace, hairlines and grouped lists; a listing is a photo with text under it.
- **The icon-chip row.** Every row led by a tinted rounded square holding a coloured icon.
  Use naked icons at a fixed width, or none.
- **Grey soup.** Inline greys per screen. Use the token ramp only.
- **Glass spam.** Blur on cards "for a premium feel". Glass is for navigation chrome only.
- **Badge confetti.** Status pills on every row. Pills carry real state, at most one per row.
- **Oversized radius on everything,** inputs included. Keep the shape scale.

**Structure and navigation**
- **Magic top padding** instead of safe-area insets (`env(safe-area-inset-*)`).
- **Chevrons everywhere.** A chevron means "tap pushes a screen", nothing else.
- **Hand-rolled modals** without a proper sheet (focus, Escape, scroll lock, return focus).
- **Undersized tap targets.** 44px minimum.
- **Flat settings lists.** Grouped sections, destructive actions last in red.
- **Content under the home indicator.** Bottom insets on every scrollable.
- **Double headers.** One header owner per screen.

**Copy**
- Greetings ("Welcome back"), exclamation marks, em dashes, placeholder names, fake-precise numbers.
- Placeholder-as-label forms; inputs without the right `inputmode`/`autocomplete`.

**Motion and states**
- **No press feedback,** or a bare opacity flash. Scale on press, instantly.
- **Spinner-only loading.** Skeletons for content.
- **Missing states.** Every list has empty, error and loading states.
- **Decorative entrances on everything,** replaying as you scroll. Entrance only on the first screen.

**Behaviour**
- **Dead settings** that toggle but nothing reads.
- **Destructive residue.** Logout/delete must clear everything it set up (caches, push, sessions).
