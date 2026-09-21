import type Database from "better-sqlite3";
import { getPlaybackTarget } from "@testcard/core/src/db/queries.js";
import { fetchCatchupProgrammes, splitCatchup, type CatchupProgramme } from "@testcard/core/src/source/xtream/catchup.js";
import type { Source } from "@testcard/core/src/source/types.js";
import { getCredentials } from "../platform/secrets";

/** A channel whose provider keeps past programmes to play back. Xtream only; live playback never needs it. */
export interface ChannelCatchup {
  readonly source: Source;
  readonly streamId: string;
  readonly days: number;
}

export interface CatchupGuide {
  /** What is airing now, if the provider can play it from the start. */
  readonly current: CatchupProgramme | undefined;
  /** What has already aired, newest first. */
  readonly past: readonly CatchupProgramme[];
}

export function channelCatchup(db: Database.Database, channelId: string): ChannelCatchup | undefined {
  const row = db.prepare(`SELECT catchup_days AS days FROM channels WHERE id = ?`).get(channelId) as { days: number | null } | undefined;
  if (row === undefined || row.days === null || row.days <= 0) return undefined;
  const target = getPlaybackTarget(db, channelId);
  if (target === undefined || target.source.kind !== "xtream") return undefined;
  return { source: target.source, streamId: target.variant.providerStreamId, days: row.days };
}

export async function loadCatchupGuide(catchup: ChannelCatchup): Promise<CatchupGuide> {
  const programmes = await fetchCatchupProgrammes(catchup.source, catchup.streamId, getCredentials);
  return splitCatchup(programmes, new Date(), catchup.days);
}
