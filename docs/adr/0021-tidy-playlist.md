# ADR 0021: Tidy playlist (TV Guide lists)

## Status

Accepted (2026-11-03). First stage, for Windows and Fire TV. Later stages are listed under Consequences.

## Context

Providers list one channel many times: in several qualities, and again under other groups (local affiliates, sports packs, "24/7").
A viewer browsing by the provider's groups sees the same station over and over and finds the guide only on some copies. Services
such as EPGenius rewrite the whole playlist into tidy groups, which changes ids, names and streams (see ADR 0018). We want the
result without the rewrite.

What EPGenius's output shows (a playlist and the provider's own channel list lined up by stream id, 2026-11-02): most groups are a
renamed copy of one provider category; a few are built from dozens of categories (a country's "TV Guide", "24/7"); the "TV Guide"
lists are the channels that have real guide ids, by country, one stream chosen for each station; junk rows (separators, "No event"
placeholders) are dropped; placeholder guide ids (`dummy-...`) stand in for channels with no listings.

## Decision

1. **A view over the catalogue, never a rewrite.** Nothing in `channels`, `channel_variants` or any category changes. The provider's own
   groups stay in the rail underneath.
2. **"TV Guide" lists.** For a source with the switch on (`sources.epg_optimise`, now labelled "Tidy playlist and improve TV guide"; no
   new column), the Live TV rail gets one list per country: the channels that really have listings (programmes), one per station
   (`sameChannelKey`) and country, the best quality first (`fallbackRank`), by name. A station is not merged across sources.
   The country is the channel's own parsed one (`XX|`), else its category's ("UK| SPORT"), else a prefix of its name ("UK: BBC One",
   "US - NBC"), and only a known country code counts (`guideCountryOf`): "NBA", "PRIME" or "VIP" prefixes are leagues and services,
   not lists. A channel with no known country is left to the provider's groups. The stored `channels.country` is not widened,
   because it feeds channel ids (and so Favourites); the Strong provider writes "UK: ..." in channel names, which it never read.
   The guide matcher is given the same country, so a channel's copies in other markets are told apart. The other copies stay reachable as that channel's feeds (ADR 0015).
   `listGuideCountries` and `browseGuideChannels` (`db/tidyLists.ts`, `core/db/TidyLists.kt`); the rail id is `guide:<country>`, or
   `guide:<country>@<source>` inside one source's section.
3. **Tidy categories.** The provider's live categories of a tidied source are also gathered into lists that read as one
   (`listTidyCategories`, `browseTidyCategory`; `tidy:` ids): the same subject in the same country, whatever its quality or source tag
   ("UK| SPORT ᴴᴰ", "UK| SPORT ᴿᴬᵂ ⁶⁰ᶠᵖˢ" and "UK| SPORT ʰᵉᵛᶜ" are one "Sport"), by `tidyCategoryLabel`. Events and pay-per-view groups are
   kept apart (a section "UK · Events", their trailing "PPV" dropped). A list shows each station once, the best quality first, by name.
   The rail reads TV Guide, then a section per country (UK, USA, Canada, Australia first, then the rest, then "Other"), then the
   provider's own groups unchanged under "Provider groups", so nothing the provider lists is hidden by tidying (separator, junk and
   adult categories aside). An unrecognised prefix ("BEE|") stays in the name, because "Other" mixes places. In a multi-source rail
   only the TV Guide lists are added so far.
4. **Lists from what channel names say, for any provider** (`epg/tidyKnowledge.ts`, `listFacetLists`, `browseFacetList`; ids `league:<key>`,
   `local:<key>`). A table of leagues (NFL, NBA, NHL, MLB, MLS, the big football leagues, UEFA, F1, UFC, tennis, golf, cricket, rugby...) and of
   broadcast networks is matched against a channel's name and its category's name, whatever the provider's prefix or styling: "🏈 NFL" gathers
   the NFL channels wherever the provider filed them. A network's *local stations* ("NBC 5 (WMAQ) Chicago", "NBC [Boston]", "WILKES BARRE, PA
   WBRE NBC 28") are told from its national services ("FOX News", "NBC Sports") by call letters, a city in brackets, or a channel number, and get a
   list per network ("📺 NBC local stations"). A list needs three stations; a station counts once per country. Empty event slots ("NHL 01: No
   Game Today", "- NO EVENT STREAMING -") and divider rows ("##### NCAAF #####") are not stations and are left out of every tidy list. The tables
   are data: the Kotlin port is copied from them and `test-vectors/tidyFacets.json` pins the answers. Measured on Strong (18,581 channels): NBC 589
   local stations (EPGenius, hand-curated: 615), FOX 314 (297), ABC 180 (185), CBS 266 (299); every list in 230 ms.
5. **TV Guide lists are national channels.** A network's local stations are left out of them (they have their own lists), as are placeholders.
6. **Rail order:** TV Guide, Sports (leagues), Local stations, a section per country with its events, then the provider's own groups.
7. **Placeholders are not listings.** Guide channels called `dummy-...` only stand in for channels with no real listings
   ("NO EVENT STREAMING"). With the switch on, the matcher never links to one and a channel whose own `tvg-id` is one gets no listings,
   so the list shows only real coverage. (`isPlaceholderGuideId`.)
8. **Junk hidden on Windows too.** Categories tagged `junk`, `separator` or `adult` are left out of the Windows Live TV rail, as they
   already were on Fire TV and mobile.
9. **Shared by both apps.** The Fire TV port reproduces the TypeScript with the same cases in its tests; the label and id helpers are
   pure (`epg/guideListLabels.ts`) so the renderer can use them.

## Consequences

- Off, nothing changes. A guide the source has not imported yet gives no TV Guide lists until it has.
- The lists need real listings, so how many channels appear depends on the guide the source uses and on `matchGuide`; a curated guide
  that lists provider spellings (the community `epg6` guide does) links far more than the provider's own.
- The leagues and networks are a table, so a league or network that is not in it gets no list of its own (it still appears in the
  provider's groups and the country sections). Adding one is a line in `tidyKnowledge.ts` and a regenerated Kotlin table.
- Not yet built: friendlier channel names and logos from the guide, stepping through a station's copies by hand, tidy lists in a
  multi-source rail, and syncing the switch between devices.
- Found on the way, not changed: `sameChannelKey` and `fallbackRank` read a name ending in "K" as a quality tag, so "NFL Network" keys as
  "nfl networ" and ranks like a 4K stream. It is consistent for matching but can pick the wrong copy to show first; the rules feed the failover
  vectors of both apps, so it is a separate change.
- A provider that writes the country nowhere (no category prefix, no name prefix) gets no country lists. A big country's list can be
  large (about 1,300 US channels for Strong, mostly local affiliates); grouping them by network is the next stage.
