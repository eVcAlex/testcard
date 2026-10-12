# ADR 0015: A web player at /watch, streaming through the Worker

## Status

Accepted (2026-10-12). Built; switched off by default (`WEB_PLAYER = "off"` in `apps/sync-worker/wrangler.toml`).

## Context

There is no native app for iOS. A browser player is the way onto an iPhone, and it also reaches any computer without the
Windows app. A browser cannot talk to an IPTV provider itself: providers send no CORS headers, many are plain `http://`
(which an `https://` page may not load), and the video has to be fetched by something the page can reach.

## Decision

1. **`apps/player`** is a small Preact app, built into the website's output at `/watch` (so the Worker serves it from the
   same origin as the API). It signs in with the Testcard account through the shared `SyncClient`, pulls the account's
   sealed sources and opens them **in the browser** with the password (`decryptCredentials`), exactly as the apps do. The
   password and the opened logins are held in memory only; nothing is written to browser storage except two per-device
   conveniences: where a film or episode was left, and the "switch feed when it buffers" choice.
2. **`GET /watch/p?u=<address>`** on the sync Worker is the stream proxy. It needs a signed-in account (the session cookie
   rides along on media requests; headers would not), follows redirects itself and checks every hop, refuses private
   networks and this service's own addresses, passes `Range` through, streams the body without buffering, and rewrites HLS
   playlists so segments and keys also come back through it. It never forwards the viewer's cookies.
3. **It is off until `WEB_PLAYER = "on"`** is set in `wrangler.toml` and deployed: it makes the Worker carry viewers'
   video. The player says "not switched on yet" while it is off.
4. **Playback**: HLS through hls.js (native HLS on iOS and iPadOS), raw MPEG-TS through mpegts.js where the browser has Media
   Source, anything else straight into the video element. Both libraries load only when a stream needs one. A live channel
   is offered as HLS first, then as the raw stream, then as its other qualities and listings (`feedsFor`, the web twin of
   `listChannelFeeds`). A feed that errors, never starts, or buffers for 3 seconds is moved on from (`FeedHealth`, the twin of
   `PlaybackHealth.kt`); the viewer can turn the buffering switch off.
5. **No local database.** The web player asks the provider's JSON API per category and holds the answers in memory for the
   visit. It does not import a catalogue, so there is no SQLite in the browser, no sync of favourites, recents or progress,
   no profiles and no TV guide yet.

## Consequences

- Reaching a provider from the Worker can fail where a home connection would not (non-standard ports, raw IP addresses,
  providers that block data-centre addresses). The player shows the provider's host and the reason.
- Films that are MKV or HEVC, and audio the browser cannot decode (AC-3), will not play in some browsers. There is no
  transcoding; that would be a separate service.
- Cost: Workers charge for requests and CPU time, not outbound data, as far as we know; check Cloudflare's current terms for
  proxying video before switching it on. The Worker carries every viewer's video, so abuse limits matter (a daily cap per
  account is the obvious next step).
- The CSP now allows `blob:` for media and workers (hls.js and mpegts.js use them).
- Provider logins appear in addresses the proxy sees and forwards. They are not logged by this code.

## Not done

Favourites, recents, resume and profiles synced with the apps; the TV guide; M3U series; pinned categories; a proper PWA install
experience; per-account usage caps.
