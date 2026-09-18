# ADR 0008: M3U playlists can hold films and episodes

## Status

Accepted. Supersedes the "Movies and Series are Xtream-only" scope note in the original design.

## Context

M3U providers routinely put films and series in the same playlist as live channels. Testcard imported
every entry as a live channel, so a film library showed up as thousands of "channels" in Live TV and
Movies/Series stayed empty for M3U sources. M3U has no catalogue API, no metadata call and no field
saying what an entry is.

## Decision

1. **One deterministic classifier.** `classifyEntry` (`packages/core/src/source/m3u/classifyEntry.ts`)
   reads the two things a playlist has: the stream URL and the title. `/live/` is always live; a
   `/movie/` or `/series/` path or a video-file extension (`mp4 mkv avi mov m4v wmv flv mpg mpeg webm`,
   never `ts` or `m3u8`) marks VOD; an `S01E02` or `1x02` marker with a show title before it makes an
   episode, otherwise the entry is a film. Anything else stays live, which is what every entry was
   before. No network, no clock, no AI.
2. **One fetch, one parse.** `createM3UAdapter().loadPlaylist` returns the live pages and a VOD
   catalogue from a single streaming pass. `importAll` (live only) is unchanged for callers.
3. **Same tables as Xtream VOD.** `importM3UVod` writes `movies`, `series`, `seasons` and `episodes`,
   so browsing, search, favourites, resume and sync work identically. The direct stream URL is stored
   as `provider_stream_id` / `provider_episode_id` and played as is. Series get
   `episodes_fetched_at` set at import, so the Xtream-only lazy fetch never runs for them.
4. **Ids come from the title, not the URL.** Providers rotate tokens and embed logins in URLs. Movie,
   series and episode ids and their `remote_key`s (sha1 of the playlist URL and the title key) stay
   stable across refreshes and across devices on the same playlist, so favourites and progress
   survive. A film or episode listed twice keeps the first.
5. **Content switches apply to M3U too.** The Live / Movies / Series switches on a source now work for
   both kinds. A VOD entry is never imported as a live channel, even with Movies switched off.
6. **Leftovers are cleaned once.** Imports never delete, so channels created by the old behaviour are
   removed by `removeVodFromLive` (with any live category that leaves empty) the first time a
   refresh recognises them as films or episodes. It is a no-op afterwards.

## Consequences

- Classification is heuristic. A film served as `.ts`, or an episode whose title has no `S01E02`
  marker, is not recognised: the first stays live, the second shows under Movies. The failure is
  "in the wrong section", never "lost".
- M3U films have no plot, year, rating or duration, only the playlist's `tvg-logo` as a poster.
- A refresh re-downloads the whole playlist; a VOD-heavy one is large. The catalogue is held in
  memory during import, like the live pages already were.
- Existing M3U sources pick this up on their next refresh (the app refreshes stale catalogues when
  Movies or Series is opened).
