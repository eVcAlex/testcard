# ADR 0018: Optional guide matching by name

## Status

Accepted (2026-10-29). Built for Windows and for Fire TV (a Kotlin port that must reproduce `test-vectors/guideMatch.json`).

## Context

A guide is linked to a channel only by `channels.tvg_id` equalling the XMLTV `<channel id>` (ADR 0003). Playlists often
leave `tvg-id` blank or use ids the guide does not know, so those channels show no guide. The separate `epg-mapper`
project fixes this by rewriting the whole playlist, which would change the stream URLs, ids and groups that Favourites
and Recents hang off, drops entries it cannot place, and is built around one provider.

## Decision

1. **Matching only, never rewriting.** `matchGuide` (`packages/core/src/epg/matchGuide.ts`) says which guide id a channel's
   listings should come from. Channel ids, names, categories, `tvg_id` and streams are never changed.
2. **Conservative.** A channel whose own `tvg-id` the guide knows is left alone. Otherwise a curated alias, or a name that
   matches exactly after the existing cleaning (`channelDisplayName` and `sameChannelKey`, so quality words, styling and
   country prefixes do not matter, and "+1" stays apart). Several fits are told apart by the channel's country against
   the guide id's market suffix; if that cannot, the channel is counted as ambiguous and left unlinked. No fuzzy matching:
   a wrong guide is worse than none.
3. **Done during the import.** `importEpg({ optimise: true })` reads the guide's `<channel>` list (XMLTV lists channels
   before programmes), matches, and fans listings out exactly as it does for `tvg_id`s. Nothing extra is stored, so
   turning it off and refreshing restores the plain result. A guide that names no channels gives no matching figures
   rather than invented ones. It does not apply to the daily prebuilt guide files (`importGuideFile`), which carry
   no channel names.
4. **A per-source switch, off by default**, `sources.epg_optimise` (schema v16), shown as "Improve TV guide matching" on
   the source form. It is not synced yet. Changing it reloads the source in the background. After a refresh the source
   card says how many channels have a guide.

## Consequences

- Playback is untouched; a failure in matching falls back to the plain import.
- Curated aliases are supported by `matchGuide` but nothing supplies them yet.
- The Fire TV port (`epg/GuideMatch.kt`, `Xmltv.kt`, `EpgImport.kt`) shares the vectors, so the two cannot drift. Its matcher, XMLTV
  channel reading and import glue run in JVM tests; the database-backed import and the settings switch could only be
  type-read, not built, where this was written (Google's Maven host was unreachable).
- A source with it on always reads the guide itself, because the Worker's shared guide files carry no channel names; switching it
  on or off marks the recorded guide stale so it is read again the new way.
- Sync of the switch, curated aliases and a tidy-up layer for categories and ordering are still to do.
