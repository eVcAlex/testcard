import type Database from "better-sqlite3";
import { channelShown } from "../sync/hidden.js";
import { fallbackRank, sameChannelKey } from "../normalise/displayName.js";
import { CHANNEL_COLUMNS, type ChannelRow } from "./queries.js";
import type { GuideCountry } from "../epg/guideListLabels.js";

interface Lead {
  readonly id: string;
  readonly country: string;
  readonly name: string;
}

/**
 * The channels of tidy sources (`sources.epg_optimise`) that really have listings, one per station and country: of a
 * station's qualities and of the copies a provider files under other groups, the one to show (HD before an unmarked
 * one, SD, then 4K; the first listed on a tie). The others stay reachable as that channel's feeds. A station is not
 * merged across sources, and a channel without a parsed country is left to the provider's own groups.
 */
function guideLeads(db: Database.Database, sourceId?: string): Lead[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.source_id AS sourceId, c.country, c.normalised_name AS name
       FROM channels c JOIN sources s ON s.id = c.source_id AND s.epg_optimise = 1
       WHERE c.country IS NOT NULL AND ${channelShown(db, "c")}${sourceId !== undefined ? " AND c.source_id = ?" : ""}
         AND EXISTS (SELECT 1 FROM programmes p WHERE p.channel_id = c.id)
       ORDER BY c.rowid`,
    )
    .all(...(sourceId !== undefined ? [sourceId] : [])) as { id: string; sourceId: string; country: string; name: string }[];
  const best = new Map<string, { lead: Lead; rank: number }>();
  for (const row of rows) {
    const key = `${row.sourceId}\u0000${row.country}\u0000${sameChannelKey(row.name)}`;
    const rank = fallbackRank(row.name);
    const held = best.get(key);
    if (held === undefined || rank < held.rank) best.set(key, { lead: { id: row.id, country: row.country, name: row.name }, rank });
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
