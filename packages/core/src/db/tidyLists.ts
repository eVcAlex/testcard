import type Database from "better-sqlite3";
import { channelShown } from "../sync/hidden.js";
import { fallbackRank, sameChannelKey } from "../normalise/displayName.js";
import { CHANNEL_COLUMNS, type ChannelRow } from "./queries.js";
import { channelGuideCountry, guideCountryOf, parseFacetListId, parseTidyCategoryId, tidyCategoryId, tidyCategoryLabel, facetListId, type FacetList, type GuideCountry, type TidyCategory } from "../epg/guideListLabels.js";
import { LEAGUES, NETWORKS, isPlaceholderChannelName, leagueListLabel, leaguesOfChannel, localListLabel, localNetworkOf } from "../epg/tidyKnowledge.js";
import { decodeTags } from "../normalise/classifyCategory.js";
import { categoryShown } from "../sync/hidden.js";

interface Lead {
  readonly id: string;
  readonly sourceId: string;
  readonly country: string;
  readonly name: string;
}

/**
 * A list's channels with each station's copies together: all its qualities, and the copies a provider files under other groups,
 * one after another, the best quality first (HD, unmarked, SD, then 4K; the order the provider listed them on a tie), the stations
 * in the order the provider lists them (its own order is the one a viewer knows: Main Event, Premier League, 1, 2...). Nothing is left out: if one copy will not play, the next row is another way into the same channel. A station is told by
 * `keyOf`, which keeps the same name in different countries or sources apart.
 */
function inStationOrder<T extends { readonly name: string }>(rows: readonly T[], keyOf: (row: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }
  const stations = [...groups.values()].map((group) => group.map((row, at) => ({ row, at, rank: fallbackRank(row.name) })).sort((a, b) => a.rank - b.rank || a.at - b.at).map((entry) => entry.row));
  return stations.flat();
}

/**
 * The channels of tidy sources (`sources.epg_optimise`) that really have listings, with a known country (its own, its
 * category's, or a "UK:" prefix of its name; the rest are left to the provider's own groups), a station's copies together
 * (`inStationOrder`). A station is not merged across sources.
 */
function guideLeads(db: Database.Database, sourceId?: string): Lead[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.source_id AS sourceId, c.country, cat.country AS categoryCountry, c.raw_name AS rawName, c.normalised_name AS name
       FROM channels c JOIN sources s ON s.id = c.source_id AND s.epg_optimise = 1
       LEFT JOIN categories cat ON cat.id = c.category_id
       WHERE ${channelShown(db, "c")}${sourceId !== undefined ? " AND c.source_id = ?" : ""}
         AND EXISTS (SELECT 1 FROM programmes p WHERE p.channel_id = c.id)
       ORDER BY c.rowid`,
    )
    .all(...(sourceId !== undefined ? [sourceId] : [])) as { id: string; sourceId: string; country: string | null; categoryCountry: string | null; rawName: string; name: string }[];
  const leads: Lead[] = [];
  for (const row of rows) {
    const country = channelGuideCountry(row.country, row.categoryCountry, row.rawName);
    // A network's local stations have their own lists, and an event slot with nothing on is not a station.
    if (country === null || localNetworkOf(row.rawName) !== null || isPlaceholderChannelName(row.rawName)) continue;
    leads.push({ id: row.id, sourceId: row.sourceId, country, name: row.name });
  }
  return inStationOrder(leads, (lead) => `${lead.sourceId}\u0000${lead.country}\u0000${sameChannelKey(lead.name)}`);
}

/** The countries a tidy "TV Guide" list is offered for, with how many channels each lists, the biggest first. */
export function listGuideCountries(db: Database.Database, sourceId?: string): GuideCountry[] {
  const counts = new Map<string, number>();
  for (const lead of guideLeads(db, sourceId)) counts.set(lead.country, (counts.get(lead.country) ?? 0) + 1);
  return [...counts.entries()].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
}

/** The channels of one country's "TV Guide" list: every channel with listings, a station's qualities together, by station name. */
export function browseGuideChannels(db: Database.Database, opts: { country: string; sourceId?: string; limit?: number }): ChannelRow[] {
  const ids = guideLeads(db, opts.sourceId)
    .filter((lead) => lead.country === opts.country)
    .slice(0, opts.limit ?? 5000)
    .map((lead) => lead.id);
  const byId = new Map<string, ChannelRow>();
  for (let from = 0; from < ids.length; from += 500) {
    const part = ids.slice(from, from + 500);
    const rows = db.prepare(`SELECT ${CHANNEL_COLUMNS} FROM channels c WHERE c.id IN (${part.map(() => "?").join(",")})`).all(...part) as ChannelRow[];
    for (const row of rows) byId.set(row.id, row);
  }
  return ids.flatMap((id) => byId.get(id) ?? []);
}

interface TidyRow {
  readonly categoryId: string;
  readonly sourceId: string;
  readonly rawName: string;
  readonly country: string | null;
  readonly tags: string | null;
  readonly channelId: string;
  readonly channelRaw: string;
  readonly name: string;
}

/**
 * The channels of tidy sources' live categories, with the category each is in. Separator, junk and adult categories are left out,
 * as in the Fire TV rail; hidden ones are too.
 */
function tidyRows(db: Database.Database, sourceId?: string, categoryIds?: readonly string[]): TidyRow[] {
  const rows = db
    .prepare(
      `SELECT cat.id AS categoryId, cat.source_id AS sourceId, cat.raw_name AS rawName, cat.country, cat.tags, c.id AS channelId, c.raw_name AS channelRaw, c.normalised_name AS name
       FROM categories cat
       JOIN sources s ON s.id = cat.source_id AND s.epg_optimise = 1
       JOIN channels c ON c.category_id = cat.id
       WHERE ${categoryShown(db, "cat", "live")} AND ${channelShown(db, "c")}${sourceId !== undefined ? " AND cat.source_id = ?" : ""}
       ORDER BY cat.rowid, c.rowid`,
    )
    .all(...(sourceId !== undefined ? [sourceId] : [])) as TidyRow[];
  const wanted = categoryIds === undefined ? null : new Set(categoryIds);
  return rows.filter((row) => {
    if (wanted !== null && !wanted.has(row.categoryId)) return false;
    const tags = decodeTags(row.tags);
    return !tags.includes("junk") && !tags.includes("separator") && !tags.includes("adult") && !isPlaceholderChannelName(row.channelRaw);
  });
}

/**
 * The provider's categories of tidy sources, gathered into lists that read as one: the same subject in the same country, whatever
 * its quality or source tag ("UK| SPORT ᴴᴰ", "UK| SPORT ᴿᴬᵂ", "UK| SPORT ʰᵉᵛᶜ" are one "Sport"). Events and pay-per-view groups are kept
 * apart from the rest. Each list counts every channel it shows. By country (UK, USA, Canada, Australia first, then the rest, then no known country), then name.
 */
export function listTidyCategories(db: Database.Database, sourceId?: string): TidyCategory[] {
  interface Group { label: string; country: string | null; ppv: boolean; categoryIds: Set<string>; count: number; firstRow: number }
  const groups = new Map<string, Group>();
  let order = 0;
  for (const row of tidyRows(db, sourceId)) {
    const ppv = decodeTags(row.tags).includes("ppv");
    const country = guideCountryOf(row.country);
    const label = tidyCategoryLabel(row.rawName, ppv);
    const key = `${row.sourceId}\u0000${country ?? ""}\u0000${ppv ? 1 : 0}\u0000${label.toLowerCase()}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { label, country, ppv, categoryIds: new Set(), count: 0, firstRow: order++ };
      groups.set(key, group);
    // Of the spellings of one name, the one that is not all capitals reads better.
    } else if (/[a-z]/.test(label) && !/[a-z]/.test(group.label)) group.label = label;
    group.categoryIds.add(row.categoryId);
    group.count += 1;
  }
  const rank = (country: string | null) => {
    const at = ["UK", "US", "CA", "AU", "IE", "NZ"].indexOf(country ?? "");
    return country === null ? 99 : at < 0 ? 50 : at;
  };
  return [...groups.values()]
    .sort((a, b) => rank(a.country) - rank(b.country) || (a.country ?? "").localeCompare(b.country ?? "") || Number(a.ppv) - Number(b.ppv) || a.label.localeCompare(b.label))
    .map((g) => ({ id: tidyCategoryId([...g.categoryIds]), label: g.label, country: g.country, ppv: g.ppv, count: g.count }));
}

/** The channels of one tidy list: every channel of its categories, a station's qualities together, the best first, by station name. */
export function browseTidyCategory(db: Database.Database, opts: { id: string; limit?: number }): ChannelRow[] {
  const categoryIds = parseTidyCategoryId(opts.id);
  if (categoryIds === null || categoryIds.length === 0) return [];
  const rows = tidyRows(db, undefined, categoryIds).map((row) => ({ id: row.channelId, sourceId: row.sourceId, name: row.name }));
  const ids = inStationOrder(rows, (row) => `${row.sourceId}\u0000${sameChannelKey(row.name)}`).slice(0, opts.limit ?? 5000).map((row) => row.id);
  const byId = new Map<string, ChannelRow>();
  for (let from = 0; from < ids.length; from += 500) {
    const part = ids.slice(from, from + 500);
    for (const row of db.prepare(`SELECT ${CHANNEL_COLUMNS} FROM channels c WHERE c.id IN (${part.map(() => "?").join(",")})`).all(...part) as ChannelRow[]) byId.set(row.id, row);
  }
  return ids.flatMap((id) => byId.get(id) ?? []);
}

interface FacetRow {
  readonly channelId: string;
  readonly sourceId: string;
  readonly rawName: string;
  readonly name: string;
  readonly country: string | null;
  readonly categoryRaw: string;
}

/** The channels of tidy sources' live categories that are stations (not dividers or empty event slots), for the league and local lists. */
function facetRows(db: Database.Database, sourceId?: string): FacetRow[] {
  const rows = db
    .prepare(
      `SELECT c.id AS channelId, c.source_id AS sourceId, c.raw_name AS rawName, c.normalised_name AS name, c.country, cat.country AS categoryCountry, cat.raw_name AS categoryRaw, cat.tags
       FROM channels c
       JOIN sources s ON s.id = c.source_id AND s.epg_optimise = 1
       JOIN categories cat ON cat.id = c.category_id
       WHERE ${channelShown(db, "c")} AND ${categoryShown(db, "cat", "live")}${sourceId !== undefined ? " AND c.source_id = ?" : ""}
       ORDER BY c.rowid`,
    )
    .all(...(sourceId !== undefined ? [sourceId] : [])) as (Omit<FacetRow, "country"> & { country: string | null; categoryCountry: string | null; tags: string | null })[];
  const out: FacetRow[] = [];
  for (const row of rows) {
    const tags = decodeTags(row.tags);
    if (tags.includes("junk") || tags.includes("separator") || tags.includes("adult") || isPlaceholderChannelName(row.rawName)) continue;
    out.push({ channelId: row.channelId, sourceId: row.sourceId, rawName: row.rawName, name: row.name, country: channelGuideCountry(row.country, row.categoryCountry, row.rawName), categoryRaw: row.categoryRaw });
  }
  return out;
}

/** What a channel belongs to, by what its name (and its category's) says: league keys and the network of a local station. */
function facetsOf(row: FacetRow): { leagues: string[]; local: string | null } {
  return { leagues: leaguesOfChannel(row.rawName, row.categoryRaw, row.country), local: localNetworkOf(row.rawName) };
}

const stationKey = (row: FacetRow) => `${row.sourceId}\u0000${row.country ?? ""}\u0000${sameChannelKey(row.name)}`;

/** A list needs this many channels to be worth showing: a stray match is not a list. */
const FACET_LIST_LEAST = 3;

/**
 * The league lists ("🏈 NFL") and local-station lists ("📺 NBC local stations") of tidy sources, from what channel names say, for any
 * provider. A list counts every channel in it, a station's qualities and copies included. Leagues come first in the order of `LEAGUES`,
 * then networks in the order of `NETWORKS`; one with fewer than three channels is left out.
 */
export function listFacetLists(db: Database.Database, sourceId?: string): FacetList[] {
  const leagues = new Map<string, number>();
  const locals = new Map<string, number>();
  for (const row of facetRows(db, sourceId)) {
    const facets = facetsOf(row);
    for (const league of facets.leagues) leagues.set(league, (leagues.get(league) ?? 0) + 1);
    if (facets.local !== null) locals.set(facets.local, (locals.get(facets.local) ?? 0) + 1);
  }
  const out: FacetList[] = [];
  for (const league of LEAGUES) {
    const count = leagues.get(league.key) ?? 0;
    if (count >= FACET_LIST_LEAST) out.push({ id: facetListId("league", league.key, sourceId), label: leagueListLabel(league), kind: "league", count });
  }
  for (const network of NETWORKS) {
    const count = locals.get(network.key) ?? 0;
    if (count >= FACET_LIST_LEAST) out.push({ id: facetListId("local", network.key, sourceId), label: localListLabel(network), kind: "local", count });
  }
  return out;
}

/** The channels of one league or local-stations list: every channel in it, a station's qualities together, the best first, by station name. */
export function browseFacetList(db: Database.Database, opts: { id: string; sourceId?: string; limit?: number }): ChannelRow[] {
  const parsed = parseFacetListId(opts.id);
  if (parsed === null) return [];
  const sourceId = parsed.sourceId ?? opts.sourceId;
  const rows = facetRows(db, sourceId).filter((row) => {
    const facets = facetsOf(row);
    return parsed.kind === "league" ? facets.leagues.includes(parsed.key) : facets.local === parsed.key;
  });
  const ids = inStationOrder(rows, stationKey).slice(0, opts.limit ?? 5000).map((row) => row.channelId);
  const byId = new Map<string, ChannelRow>();
  for (let from = 0; from < ids.length; from += 500) {
    const part = ids.slice(from, from + 500);
    for (const row of db.prepare(`SELECT ${CHANNEL_COLUMNS} FROM channels c WHERE c.id IN (${part.map(() => "?").join(",")})`).all(...part) as ChannelRow[]) byId.set(row.id, row);
  }
  return ids.flatMap((id) => byId.get(id) ?? []);
}
