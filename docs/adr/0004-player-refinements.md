# ADR 0004: Aspect-ratio control and the logo cache

## Status

Accepted (Phase 3). Two small player refinements that shipped alongside EPG import.

## Aspect ratio

An `AspectMode` of `fit | fill | 16:9 | 4:3`, cycled from a pill button in the on-video overlay.
Implemented as mpv properties, not window geometry (`MpvPlayer.setBounds` is deliberately a
no-op — mpv fills its host window's client area):

| Mode | `video-aspect-override` | `panscan` |
|---|---|---|
| `fit` (default) | `-1` | `0` |
| `fill` | `-1` | `1` (zoom-crop to cover) |
| `16:9` | `16:9` | `0` |
| `4:3` | `4:3` | `0` |

State lives on `PlaybackController`, persisted via `electron-conf` exactly like `volume`
(read on construct, re-applied inside `play()` because a post-crash `MpvPlayer` is a fresh
process, echoed as a `PlaybackEvent` so the overlay stays in sync, and included in
`PlaybackSnapshot` for pull-on-mount).

## Logo cache

Channel logos were loaded straight from provider CDNs by the renderer's `<img>` — hundreds of
hosts learning the user's IP, mitigated only by `referrerPolicy="no-referrer"`. They now go
through a privileged custom scheme, `testcard-logo://logo?u=<encoded https url>`:

- `registerLogoScheme()` runs at `main/index.ts` module load (before `app.whenReady` — a
  privileged scheme can't be registered later); `registerLogoProtocol()` installs the handler
  after ready.
- The handler hashes the URL (sha1), serves `userData/logo-cache/<hash>` on a hit, otherwise
  `fetch`es it (neutral UA, no Referer), writes the file, returns the bytes. An in-flight
  `Map` dedupes concurrent requests for the same logo. A fetch failure returns 404 so the
  card's existing initials fallback (`onError`) still fires.
- Content type is derived from the URL extension (default `image/png`) — good enough; a
  provider serving a mistyped extension gets a wrong `Content-Type` and the browser sniffs.
- No eviction in v1. Logos are a few KB and the working set is bounded by the channel count;
  revisit if `logo-cache/` ever grows unreasonably.
- CSP `img-src` gains `testcard-logo:` in both HTML entries. `https:` stays for any code path
  not yet migrated.
