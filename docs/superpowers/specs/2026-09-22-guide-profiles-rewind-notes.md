# Notes: TV guide grid, profiles, live rewind

Written overnight 2026-09-22 while the release was on hold. These three were on the roadmap but were not built,
because each needs a decision from Alex first. Findings and recommended approaches are below so the choice is quick.

## 1. TV guide grid

What the data looks like today:
- The live source on this account is one M3U playlist ("Strong", about 20,000 channels). There is no Xtream live source.
- The playlist's `url-tvg` header points at a public XMLTV file, `epg6.xml.gz`, 19 MB compressed (very roughly 150 to 250 MB of
  XML once unpacked). 18,944 of the 20,359 channels carry a `tvg-id`, so matching guide data to channels works.
- The Fire TV app only asks the provider for one channel's short guide at a time, and that only works for Xtream sources.
  For an M3U source the hero shows no now or next line at all.
- `packages/core/src/epg/importEpg.ts` already streams an XMLTV file into the `programmes` table and keeps only channels
  we have. The desktop app uses it. On a Fire Stick it would have to gunzip and parse the whole file in JavaScript,
  which is minutes of CPU and a lot of memory. Not acceptable on that hardware.

Options:
1. **Server side filter (recommended).** The Worker (or a scheduled job) fetches the XMLTV once a day, keeps only the next
   36 hours for channels that some account uses, and serves a small JSON per source. The TV downloads a few hundred KB.
   Needs a Worker change, so a deploy, and a Workers plan with enough CPU time for a one-off decompress (a Cron Trigger on
   the paid plan, or run the filter from GitHub Actions and put the result in R2, which needs no Worker CPU at all).
2. **Desktop pushes a slim guide.** The desktop app already imports the XMLTV; it could publish the next 36 hours for
   the user's favourite and pinned channels through sync. Only helps when the desktop is on.
3. **Do it on the TV for a handful of channels.** Fetch and parse only while the guide is open, for favourites and pinned
   channels. Still parses the whole file, so no.

Recommended UI once data exists: a Guide tab between Live TV and Movies, rows are favourites, then pinned Live categories,
then recently watched; a two-hour window that scrolls in 30 minute steps; OK plays the channel. The player and Home hero
would also gain the now and next line for M3U channels.

Decision needed: is a daily server-side job acceptable (option 1, using GitHub Actions and R2)?

## 2. Profiles

Everything personal (favourites, recents, watch progress, pins, skip windows) is keyed by title or channel id with no owner.
A profile needs a `profile_id` on about nine local tables and on every query that reads them, plus sync.

Cheapest safe design:
- A profile id is a slug of its name, so two devices that both create "Kids" agree without syncing a profile list.
- The default profile keeps today's rows and today's sync keys, so nothing existing changes.
- For other profiles the sync remote key is namespaced (`kids:<remoteKey>`), so the server needs no change and older
  clients simply ignore those rows.
- Local tables get `profile_id TEXT NOT NULL DEFAULT ''`, and each query takes the current profile.
- UI: "Who is watching" on launch (skippable when there is one profile), a Profile entry on Sources, PIN-free.

Risk: it touches most of `packages/core/src/db/*Queries.ts` and the sync collect and apply code. Should be done with the
release frozen, in one branch, with a migration test for existing data.

Decision needed: profiles per device, or shared across the account (the design above shares them)? Kids profile hiding
adult categories too?

## 3. Live rewind and record

- Provider catch-up: only about 1.8% of channels have an archive, and it lags roughly three hours behind live.
- The HLS live window is about 60 seconds, so pausing and going back further than that is not possible from the stream.
- Real rewind needs a local buffer: write the live stream to disk as it plays (a rolling 30 to 60 minutes) and play from
  that file. expo-video (ExoPlayer) has no built-in timeshift API; a buffer would mean a small native module or proxying
  the stream through a local server that records segments.
- Recording is the same buffer with "keep this".

Recommended: a prototype of a local HLS/TS segment proxy on the TV, only if rewind on sport is a priority. It is a
multi-day piece of work and the riskiest of the three.

Decision needed: is rewind worth a native module, given the provider's own catch-up covers almost none of the channels?
