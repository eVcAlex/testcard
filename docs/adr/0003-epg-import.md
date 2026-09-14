# ADR 0003: XMLTV EPG import

## Status

Accepted (Phase 3). Superset of the EPG groundwork noted in `CONTEXT.md` — this records how it
is wired.

## Context

`packages/core/src/epg/` already had a streaming XMLTV parser (`parseXmltv`) and a read-time
now/next resolver (`resolveNowNext`), and schema v1 already had the `programmes` table,
`channels.tvg_id`, and `sources.epg_url`. Nothing populated or read any of it: `importSource`
hard-coded `tvgId: null`, no adapter read the `tvg-id` attribute, and there was no programme
insert path or query. Phase 3 connects the pieces and adds a timeline guide on top.

## Decisions

### tvg-id: first non-empty wins

The M3U parser already captured every `key="value"` attribute; the adapter just never read
`tvg-id`. `RawChannelEntry` and `Channel` gain an optional `tvgId`. `groupVariants` collapses
quality duplicates into one `Channel`, and the group's first-listed entry is *not* a reliable
carrier of `tvg-id` — providers routinely leave it blank on the HD duplicate that sorts first —
so the group takes the **first non-empty** `tvg-id` across its variants. Xtream's
`epg_channel_id` maps straight through. `importSource`'s `ON CONFLICT` clause now refreshes
`tvg_id` too (it previously omitted it, so a re-import would never backfill).

### `importEpg` takes a stream, not a URL

`importEpg(db, sourceId, body, { gzipped, onProgress })` lives in core but does no I/O — the
desktop main process fetches the URL and hands in `response.body`. This keeps `packages/core`
free of Node HTTP and, crucially, keeps the credential-bearing Xtream `xmltv.php` URL built and
used only in main (same rule as `buildStreamUrl`).

### Delete-then-insert, batched, event-loop-yielding

`programmes` has no primary key. A re-import does
`DELETE FROM programmes WHERE channel_id IN (this source's channels)` then bulk-inserts — that
is the idempotency mechanism. Unlike `importSource` (which drains its generator into memory
first), an XMLTV file expands to far more rows than there are channels, so `importEpg` flushes
every 2000 rows inside a synchronous `better-sqlite3` transaction and `await`s a `setImmediate`
between flushes. Without the yield, a large guide freezes the main process for its whole
duration. Progress is pushed to the renderer on a **separate** channel, `IPC_TASK_CHANNEL`, so
the overlay window's `onPlayback` stream never sees it. After import, programmes that ended more
than 6 h ago are pruned.

### EPG URL: explicit, then auto-detected

Priority on refresh: (1) a URL the user typed into the add-source form (`AddSourceInput.epgUrl`,
stored in `sources.epg_url`); (2) `SourceAdapter.probeEpgUrl(source)` — for M3U the playlist's
`url-tvg` header (read by streaming only the `#EXTM3U` line and cancelling the rest), for Xtream
`xmltv.php` built from the stored credentials. A **credential-free** discovered URL (M3U's
`url-tvg`) is persisted back to `sources.epg_url` so the UI can show it; Xtream's
credential-bearing URL is re-derived every refresh and **never stored**.

### Gzip: only decompress what the server didn't

`parseXmltv` can gunzip via `DecompressionStream`. But if the server sets
`Content-Encoding: gzip`, `fetch` already decoded the body — decompressing again fails. So main
passes `gzipped: true` only when the URL ends `.gz` **and** the response has no
`Content-Encoding` header.

### IPC passes unix ms, never `Date`

`Programme.start` / `.end` are `Date` in core. The `epg.*` IPC surface returns `ProgrammeLite`
with `startMs` / `endMs` numbers instead — unambiguous across every serialization path, and the
renderer's `lib/time.ts` formats from them.

### EPG failure is non-fatal

A bad or unreachable guide URL emits a `{ phase: "error" }` task event and the playlist
`refresh` still returns its result. The guide is an enhancement, not a dependency.

## Consequences

- `packages/core` DB code (`importEpg`, `nowNextForChannels`, `programmesInWindow`) has no unit
  tests — `better-sqlite3`'s native binding is built for Electron's ABI, not plain Node, so
  core has never had DB-backed tests. `parseXmltv` is covered (pure). The DB paths are verified
  in the desktop smoke test.
- No schema migration was needed — `tvg_id`, `programmes` and `epg_url` were all in v1. There
  is still no migration runner; the first Phase-3 change that needs a new column will have to
  add one.
- The guide view caps at 200 channels per category. A provider category larger than that, or a
  cross-category guide, needs virtualization (`@tanstack/react-virtual`, already a dependency).
- Xtream's per-channel `get_short_epg` path (`fetchShortEpg`, already written) is still unused —
  a fallback for Xtream providers that serve no `xmltv.php`, deferred.
