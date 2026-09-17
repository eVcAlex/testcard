# ADR 0006: Theme system — semantic tokens, the Mist palette, and three micro-interactions

## Status

Accepted (Phase 4a).

## Context

The original palette (`tokens.css`) used a hot-pink `--accent` (`#ec2a6b`), borrowed wholesale
from the "IPTV Expert" reference layout the desktop shell's structure was modelled on. It was
never the app's own choice, and the token model beneath it had three latent defects that any
reskin would have hit regardless of which colour replaced the pink:

- `--accent` was **not theme-aware** — `:root[data-theme="light"]` redefined every other
  surface/ink/line token but never overrode `--accent` or `--accent-ink`, so light mode kept
  whatever colour dark mode picked, correct only by accident.
- `--track-wide` was consumed by every status pill (`chrome.css`, `.pill`) but never defined —
  every pill had rendered with default letter-spacing since the token was introduced.
- `--font-mono` named a font (`IBM Plex Mono`) that was never bundled, with zero consumers.

Fixing the accent in isolation would have left those defects in place under a new colour.

## Decision

### Token model: semantic pairs, not a raw palette

`tokens.css` moved to shadcn's semantic-pair convention: `--background`/`--foreground`,
`--card`/`--card-hover`/`--card-active`, `--border`/`--border-strong`, `--muted-foreground`/
`--faint-foreground`, `--accent`/`--accent-foreground`, `--ring`. Components read these names
directly (the old `--surface-N`/`--ink*`/`--line*` names existed only transiently, as aliases,
for one commit while call sites were repointed, then were deleted). `--accent` keeps its own
name rather than adopting shadcn's (where `accent` means a neutral hover surface, not a brand
colour) — a deliberate, commented divergence, not a half-applied convention.

This is also what makes "ditch the accent colour" cheap going forward: a reskin is one token
block instead of the ~25 call sites the old raw-palette model would have needed touching.

### Palette: "Mist"

Cool-neutral, dense, hairline-ruled, one quiet accent (`#4fb3a6` dark / `#1f7a70` light) with
muted-foreground hierarchy. Every neutral carries a slight blue-green hue bias rather than
being true grey, so the elevation ramp and the accent read as one considered family. Chosen
over several other explored directions (colour, layout-forward, and brand-identity takes) for
being the one that reads as a genuinely polished, calm consumer app rather than a design
exercise — the brief that mattered more than any single palette choice.

`--accent-foreground` (the old `--accent-ink`) is now a dark teal-tinted ink rather than plain
white — a solid `#4fb3a6` fill with white text sits under 3:1 contrast; the old hot pink was
dark enough that white-on-pink happened to work, which is part of why the light-mode gap above
went unnoticed for as long as it did.

### Motion: a small token layer, not a library

`--dur-1/2/3` (120/160/240ms) plus `--ease-out` (existing) and a new `--ease-spring` for
press/release only. Transform and opacity only, one shared easing family — the restraint
principle a proper motion system (transitions.dev) argues for, ported as three tokens rather
than a dependency this plain-CSS renderer has no build step to support.

### Three hand-ported micro-interactions

None of the component libraries surveyed alongside this work (shadcn, beui, rareui) install
into a plain React + Vite + CSS renderer — they assume Tailwind, and in shadcn's case its own
CLI and `components.json`. Rather than add a build step to borrow polish, three specific
patterns were reimplemented by hand against this app's own tokens:

- **Spring press** — `.btn:active` scales to `0.97` and releases on `--ease-spring`, replacing
  a 1px `translateY` nudge.
- **Gliding focus ring** — the search pill's `:focus-within` transitions in a `--ring`
  box-shadow over `--dur-1` instead of snapping straight to a border-colour change.
- **Logo skeleton shimmer** — `ChannelCard` renders `.pw-card-logo[data-loading]` with a
  shimmer keyframe until its `<img>` fires `onLoad`, so a cold `logoCache.ts` fetch reads as
  intentional rather than as a broken image. Carries its own `prefers-reduced-motion` guard
  (an infinite `animation` isn't covered by `base.css`'s blanket transition-duration clamp the
  way a one-shot `transition` is).

A fourth pattern considered — beui's View-Transition-API theme toggle (a `clip-path` circle
reveal via `document.startViewTransition()`) — was scoped out as a "nice, not needed" detail;
`useTheme.ts` is where it would slot in if wanted later.

### The overlay stays dark-glass in both themes

`overlay/main.tsx` hardcodes `data-theme="dark"` and is unchanged by this decision: it sits
over live video, so a light "glass" bar would fight the picture behind it regardless of the
app's own theme. It already picks up the new `--accent` for free through the token.

### No semantic secondary palette

Some explored directions used a broadcast-style secondary palette (red=live, amber=catchup,
green=favourite, ...) app-wide. Mist doesn't — `--live` remains the one reserved warm colour
(the on-air dot and the `NO SIGNAL` headline, nowhere else), deliberately the sole departure
from an otherwise cool, single-accent system rather than a colour-coded language.

## Consequences

- Fixed, not just re-skinned: `--track-wide` is now defined, `--font-mono` is gone, and
  `--accent`/`--accent-foreground` are theme-aware — a light-mode primary button, an
  accent-coloured label, and a focus ring were all previously either wrong or untested in
  light mode and are now covered by both themes deliberately.
- The SMPTE colour bars (`NoSignal.tsx`, `player.css`) are commented as an intentional
  exception: seven literal hex values that are a broadcast spec, not theme colour, and must
  never route through a token.
- `ErrorBoundary.tsx`'s fallback palette stays literal hex on purpose (it must not depend on
  the stylesheet that may itself have broken) — its values were updated to match Mist, but the
  pattern of not tokenising it is unchanged.
