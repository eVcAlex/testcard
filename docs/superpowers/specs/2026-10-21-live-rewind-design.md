# Live rewind (issue #34): a local buffer on the TV

Status: design, core buffer logic built and tested; recorder, data source and player wiring not started; nothing run on a Fire Stick.

## Goal

Pause, resume and skip back on any live channel, without needing the provider's archive (which covers almost no channels). Basic live
playback must never depend on it.

## What decides the design

1. **Live streams are progressive MPEG-TS over HTTP** (`buildLiveStreamUrl` in `Xtream.kt`: `.../live/user/pass/id.ts`). There is no
   index and no segment list, so ExoPlayer cannot seek back inside a live source. Rewind therefore works by reading our own copy of
   the stream at a byte offset, not by `player.seekTo` on the provider URL.
2. **The recorder must own the one connection.** If the player kept the connection, pausing would stop reading once its 60 s / 48 MB
   buffer fills, and recording would stop. A second connection is not an option: many Xtream accounts allow one stream, and
   `FailureScreen` already handles "every stream in use". So a recorder reads the connection and writes a rolling buffer on disk; the
   player reads the buffer. "Live" is reading the newest end.

## The trade-off, stated plainly

Using the recorder makes live playback depend on it. To keep #34's rule that basic live never depends on rewind:

- **Off unless the device can carry it.** Free space in `cacheDir` (`StatFs`) must cover the buffer, else play directly as today.
- **Fallback.** If the recorder fails (write error, disk full, no bytes for 10 s), reopen the channel directly with `MediaItem.fromUri`,
  as now, and drop rewind for that channel until it is zapped again.
- **Scope.** Full-screen live player only. Not Multi view tiles, not `LivePreview`, not a channel already playing a provider catch-up
  programme. (`timeshift` in `Playing.kt` already means provider catch-up; local rewind is called "buffer" in code.)

## Parts

**Core (`core/playback/LiveBuffer.kt`, pure and unit-tested; built):** the buffer is a run of fixed-size chunks, oldest dropped first.
`LiveBufferIndex` tracks the absolute byte offset written, the oldest offset still held, and one (arrival time, offset) mark per
second. `offsetFor(secondsBack, now)` answers where to read from, rounded down to a 188-byte TS packet and never before the oldest
held byte; `secondsBehind(offset, now)` is the reverse, for the pill. `capacityFor(freeBytes, bytesPerSecond)` caps the length.

**App (not started):**
- Recorder coroutine: drains the connection through the existing OkHttp client (User-Agent `node`), syncs to a `0x47` packet boundary
  at the start, writes chunk files, tells the index.
- A Media3 `DataSource` that serves the buffer from an offset and, at the newest end, waits for more bytes instead of ending.
- `Playing.kt`: pause/resume behind live and skip back 30 s, reusing `behindLive`, `goLive()` and the existing BEHIND LIVE pill.
- `PlaybackHealth`: waiting at the newest end of the buffer must not count as a stall (else it triggers "Trying another feed").
- Housekeeping: delete buffer files on channel change and at app start.

## Defaults and limits

- Length 30 minutes, cut down to what free space allows at the observed bitrate. The user has not chosen a length; shorter (10 to 15
  minutes) is the safe option for the oldest Stick.
- The unknown that matters is disk write speed and free space on the oldest Fire Stick. First check on hardware: record one HD channel
  for 30 minutes and watch for dropped bytes, before building any timeline UI.

## Out of scope for now

Recording ("keep this"), a scrub timeline, rewinding past the buffer, multi-device sync of anything.
