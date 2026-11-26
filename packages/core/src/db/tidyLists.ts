import type Database from "better-sqlite3";
import { channelShown } from "../sync/hidden.js";
import { fallbackRank, sameChannelKey } from "../normalise/displayName.js";
import { CHANNEL_COLUMNS, type ChannelRow } from "./queries.js";
import { channelGuideCountry, guideCountryOf, parseTidyCategoryId, tidyCategoryId, tidyCategoryLabel, type GuideCountry, type TidyCategory } from "../epg/guideListLabels.js";
import { decodeTags } from "../normalise/classifyCategory.js";
import { categoryShown } from "../sync/hidden.js";

interface Lead {
  readonly id: string;
  readonly country: string;
  readonly name: string;
}

/**
 * The channels of tidy sources (`sources.epg_optimise`) that really have listings, one per station and country: of a
 * station's qualities and of the copies a provider files under other groups, the one to show (HD before an unmarked
 * one, SD, then 4K; the first listed on a tie). The others stay reachable as that channel's feeds. A station is not
 * merged across sources, and a channel with no known country (its own, its category's, or a "UK:" prefix of its name) is
 * left to the provider's own groups.
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
  const best = new Map<string, { lead: Lead; rank: number }>();
  for (const row of rows) {
    const country = channelGuideCountry(row.country, row.categoryCountry, row.rawName);
    if (country === null) continue;
    const key = `${row.sourceId}\u0000${country}\u0000${sameChannelKey(row.name)}`;
    const rank = fallbackRank(row.name);
    const held = best.get(key);
    if (held === undefined || rank < held.rank) best.set(key, { lead: { id: row.id, country, name: row.name }, rank });
  }
  return [...best.values()].map((entry) => entry.lead).sort((a, b) => a.name.localeCompare(b.name));
}

/** The countries a tidy "TV Guide" list is offered for, the biggest first. */
export function listGuideCountries(db: Database.Database, sourceId?: string): GuideCountry[] {
  const counts = new Map<string, number>();
  for (const lead of guideLeads(db, sourceId)) counts.set(lead.country, (counts.get(lead.country) ?? 0) + 1);
  return [...counts.entries()].map(([country, count]) => ({ country, count })).sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
}

/** The channels of one country's "TV Guide" list, by name. */
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
  readonly name: string;
}

/**
 * The channels of tidy sources' live categories, with the category each is in. Separator, junk and adult categories are left out,
 * as in the Fire TV rail; hidden ones are too.
 */
function tidyRows(db: Database.Database, sourceId?: string, categoryIds?: readonly string[]): TidyRow[] {
  const rows = db
    .prepare(
      `SELECT cat.id AS categoryId, cat.source_id AS sourceId, cat.raw_name AS rawName, cat.country, cat.tags, c.id AS channelId, c.normalised_name AS name
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
    return !tags.includes("junk") && !tags.includes("separator") && !tags.includes("adult");
  });
}

/**
 * The provider's categories of tidy sources, gathered into lists that read as one: the same subject in the same country, whatever
 * its quality or source tag ("UK| SPORT ᴴᴰ", "UK| SPORT ᴿᴬᵂ", "UK| SPORT ʰᵉᵛᶜ" are one "Sport"). Events and pay-per-view groups are kept
 * apart from the rest. Each list counts a station once. By country (UK, USA, Canada, Australia first, then the rest, then no known country), then name.
 */
export function listTidyCategories(db: Database.Database, sourceId?: string): TidyCategory[] {
  interface Group { label: string; country: string | null; ppv: boolean; categoryIds: Set<string>; stations: Set<string>; firstRow: number }
  const groups = new Map<string, Group>();
  let order = 0;
  for (const row of tidyRows(db, sourceId)) {
    const ppv = decodeTags(row.tags).includes("ppv");
    const country = guideCountryOf(row.country);
    const label = tidyCategoryLabel(row.rawName, ppv);
    const key = `${row.sourceId}\u0000${country ?? ""}\u0000${ppv ? 1 : 0}\u0000${label.toLowerCase()}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { label, country, ppv, categoryIds: new Set(), stations: new Set(), firstRow: order++ };
      groups.set(key, group);
    // Of the spellings of one name, the one that is not all capitals reads better.
    } else if (/[a-z]/.test(label) && !/[a-z]/.test(group.label)) group.label = label;
    group.categoryIds.add(row.categoryId);
    group.stations.add(sameChannelKey(row.name));
  }
  const rank = (country: string | null) => {
    const at = ["UK", "US", "CA", "AU", "IE", "NZ"].indexOf(country ?? "");
    return country === null ? 99 : at < 0 ? 50 : at;
  };
  return [...groups.values()]
    .sort((a, b) => rank(a.country) - rank(b.country) || (a.country ?? "").localeCompare(b.country ?? "") || Number(a.ppv) - Number(b.ppv) || a.label.localeCompare(b.label))
    .map((g) => ({ id: tidyCategoryId([...g.categoryIds]), label: g.label, country: g.country, ppv: g.ppv, count: g.stations.size }));
}

/** The channels of one tidy list: each station once (the best quality of it, as in a "TV Guide" list), by name. */
export function browseTidyCategory(db: Database.Database, opts: { id: string; limit?: number }): ChannelRow[] {
  const categoryIds = parseTidyCategoryId(opts.id);
  if (categoryIds === null || categoryIds.length === 0) return [];
  const best = new Map<string, { id: string; name: string; rank: number }>();
  for (const row of tidyRows(db, undefined, categoryIds)) {
    const key = `${row.sourceId}\u0000${sameChannelKey(row.name)}`;
    const rank = fallbackRank(row.name);
    const held = best.get(key);
    if (held === undefined || rank < held.rank) best.set(key, { id: row.channelId, name: row.name, rank });
  }
  const ids = [...best.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, opts.limit ?? 5000).map((entry) => entry.id);
  const byId = new Map<string, ChannelRow>();
  for (let from = 0; from < ids.length; from += 500) {
    const part = ids.slice(from, from + 500);
    for (const row of db.prepare(`SELECT ${CHANNEL_COLUMNS} FROM channels c WHERE c.id IN (${part.map(() => "?").join(",")})`).all(...part) as ChannelRow[]) byId.set(row.id, row);
  }
  return ids.flatMap((id) => byId.get(id) ?? []);
}
