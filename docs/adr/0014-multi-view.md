# ADR 0014: Multi view for live TV

## Status

Proposed (2026-10-11). Fire TV first (`apps/tv-native`); Windows follows in its own change. The Fire TV build has not been run on
a stick yet: the decision rules are covered by core tests, the screen and player setup need a pass on real hardware (see Open risks).

## Context

Multi view means several live channels on one screen. The ones people have used "always buffer". That is rarely the player's
fault; it is that nothing decides what the device, the line and the provider account can carry:

- **Providers allow few simultaneous streams** (often 1 to 4, counted per account). Every picture is a connection, and a refused
  one just sits there loading.
- **Fire Sticks have a few hardware video decoders and 1 to 2 GB of RAM.** Eight 1080p pictures cannot be decoded, and a
  60 second buffer in each one (what the full-screen player uses) would not fit in memory.
- **The line is shared.** Six 1080p50 streams are ~60 Mbit/s. Pictures a quarter of the screen need a quarter of the pixels.
- **Starting them all at once** makes each slow, and a stall in one is a stall in all.

## Decision

1. **Decide before playing.** `core/playback/MultiView.kt` (pure, tested) holds every rule:
   - `deviceTileCap`: pictures by memory and the hardware AVC decoder's `maxSupportedInstances`, whichever is lower (2, 4 or 6).
   - `planTiles` + `freeStreams`: per source, no more pictures than its Xtream account has free (`max_connections` less
     `active_cons`, asked afresh), the same channel only once, the first channel (the main picture) always kept. The viewer is told
     when something was left out and why.
   - `targetHeight` + `pickFeed`: each tile asks for about 1.5x its own height in lines (480 to 1080, never 4K), and plays the
     channel's own Variant that fits, so small tiles take the 720p or SD feed. This is the cheapest way to keep several streams flowing.
2. **Light players.** `Media3Player.createTile`: 8 s read-ahead and 6 MB for a muted picture (15 s and 16 MB for the one with
   sound), against the full-screen player's 60 s and 48 MB. A muted picture has its audio track disabled, so it does not decode
   or render sound. Only the picture with sound takes audio focus. Decoder fallback is on.
3. **Stagger the start.** The picture with sound first; each other one after the one before shows a frame, or after 3.5 s.
4. **React to stalls, don't just retry** (`TileGovernor`). A picture that was playing and runs dry twice in 30 s drops to the next
   softer Variant (remembered as that tile's ceiling). With none softer it is asked for again. When several pictures stall together
   the line is short, not one stream, so the least important one (never the one with sound) is stopped, with a note and OK to
   start it again. Dead or never-starting feeds reuse `PlaybackHealth` per tile, so they move to the channel's other feeds as
   the full-screen player does.
5. **Screen variants** (`MultiLayout`, all 16:9 tiles so pictures fill them): Side by side (2), Picture in picture (2), Four grid
   (4), Spotlight with 3 beside (4), Spotlight with 5 around (6), Six grid (6). Only layouts the device can carry are offered; the
   choice is remembered (`schema_meta` `ui:multiview:layout`). "Make main picture" swaps a channel into the big place.
6. **Getting there**: holding OK on a channel in the Live TV guide offers *Add to Multi view*; once another is picked, *Open Multi
   view*. OK on a picture gives it the sound (and the big place in a spotlight layout), holding OK opens that picture's options
   (sound, make main, full screen, change layout, remove), Menu opens the layouts. Back leaves and clears the pick.

## Consequences

- A provider with one stream cannot do Multi view at all; the screen says so instead of showing broken tiles.
- Muting a picture only stops its sound, it still streams. Pausing it would save line but make it stale; not done.
- The pick lives in memory (`AppController.multiQueue`), not synced.
- Limits are heuristics; a stick that is clearly coping can be given more headroom by changing `deviceTileCap`.

## Open risks (need a stick)

- Whether several `SurfaceView`s composite cleanly under Compose on the oldest sticks (the fallback is `TextureView`, at a cost).
- Real `maxSupportedInstances` values on Fire OS; the memory rule is the backstop.
- Providers that count a connection for a few seconds after it closes (a retry in `MultiViewModel.start` covers the common case).
- The stagger and read-ahead numbers are first guesses; tune with `adb logcat` and a real provider.

## Windows (next)

The same core rules apply to the Electron app: one mpv process per picture in its own region window (ADR 0002), `hwdec=auto-safe`,
muted pictures with `--aid=no`, `--cache-secs` small, one of them with sound. The layout rectangles are reused as is.
