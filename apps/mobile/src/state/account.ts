import { useEffect, useState } from "react";
import type Database from "better-sqlite3";
import { fetchXtreamAccount, type XtreamAccount } from "@testcard/core/src/source/xtream/detect.js";
import { getCredentials } from "../platform/secrets";

/**
 * What an Xtream provider says about the viewer's account (when it ends, how many streams it allows and how many are
 * in use), asked for on demand and kept a few minutes. Playlists have no such thing.
 */

const FRESH_MS = 5 * 60 * 1000;
const known = new Map<string, { account: XtreamAccount | null; at: number }>();

export async function sourceAccount(sourceId: string, fresh = false): Promise<XtreamAccount | null> {
  const kept = known.get(sourceId);
  if (!fresh && kept !== undefined && Date.now() - kept.at < FRESH_MS) return kept.account;
  const account = await fetchXtreamAccount(await getCredentials(sourceId)).catch(() => null);
  known.set(sourceId, { account, at: Date.now() });
  return account;
}

/** The account of an Xtream source, once known; undefined while asking or for a playlist. */
export function useSourceAccount(sourceId: string, kind: "xtream" | "m3u", refreshKey: unknown = undefined): XtreamAccount | null | undefined {
  const [account, setAccount] = useState<XtreamAccount | null | undefined>(() => known.get(sourceId)?.account);
  useEffect(() => {
    if (kind !== "xtream") return;
    let live = true;
    void sourceAccount(sourceId).then((found) => live && setAccount(found));
    return () => {
      live = false;
    };
  }, [sourceId, kind, refreshKey]);
  return kind === "xtream" ? account : undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** One line about the account for its source's card, and whether it needs the viewer's attention. */
export function describeAccount(account: XtreamAccount): { text: string; warn: boolean } {
  const parts: string[] = [];
  let warn = false;
  const status = account.status?.toLowerCase();
  if (status !== undefined && status !== "active") {
    parts.push(`Account ${status}`);
    warn = true;
  } else if (account.expiresAt !== null) {
    const left = account.expiresAt - Date.now();
    const date = new Date(account.expiresAt);
    const when = `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    if (left <= 0) {
      parts.push("Subscription expired");
      warn = true;
    } else if (left < 14 * DAY_MS) {
      const days = Math.max(1, Math.ceil(left / DAY_MS));
      parts.push(`Expires in ${days} ${days === 1 ? "day" : "days"} (${when})`);
      warn = true;
    } else parts.push(`Expires ${when}`);
  } else parts.push("No end date");
  if (account.trial) parts.push("Trial");
  if (account.maxConnections !== null) {
    const max = account.maxConnections;
    parts.push(account.activeConnections !== null ? `${account.activeConnections} of ${max} ${max === 1 ? "stream" : "streams"} in use` : `${max} ${max === 1 ? "stream" : "streams"} at once`);
  }
  return { text: parts.join("  ·  "), warn };
}

/**
 * Why a stream would be refused, when the account says: every stream it allows is in use, or it has ended. Asked
 * afresh, since the count changes as other devices start and stop.
 */
export async function accountProblem(sourceId: string): Promise<string | null> {
  const account = await sourceAccount(sourceId, true);
  if (account === null) return null;
  const status = account.status?.toLowerCase();
  if ((account.expiresAt !== null && account.expiresAt <= Date.now()) || status === "expired") return "Your subscription with this provider has ended. Renew it with them to watch again.";
  if (status !== undefined && status !== "active") return `The provider says this account is ${status}.`;
  if (account.maxConnections !== null && account.activeConnections !== null && account.activeConnections >= account.maxConnections) {
    const max = account.maxConnections;
    return max === 1
      ? "Your provider allows one stream at a time, and it is in use. Stop watching on your other device and try again."
      : `Your provider allows ${max} streams at once, and they are all in use. Stop one on another device and try again.`;
  }
  return null;
}

/** The source a film, episode or channel is played from. */
export function sourceOfPlay(db: Database.Database, kind: "channel" | "movie" | "episode", id: string): { id: string; kind: string } | null {
  const sql =
    kind === "channel"
      ? `SELECT s.id, s.kind FROM channels c JOIN sources s ON s.id = c.source_id WHERE c.id = ?`
      : kind === "movie"
        ? `SELECT s.id, s.kind FROM movies m JOIN sources s ON s.id = m.source_id WHERE m.id = ?`
        : `SELECT s.id, s.kind FROM episodes e JOIN series sr ON sr.id = e.series_id JOIN sources s ON s.id = sr.source_id WHERE e.id = ?`;
  try {
    return (db.prepare(sql).get(id) as { id: string; kind: string } | undefined) ?? null;
  } catch {
    return null;
  }
}

/** The Xtream source a film, episode or channel is played from, for asking about its account. Null for a playlist. */
export function xtreamSourceOf(db: Database.Database, kind: "channel" | "movie" | "episode", id: string): string | null {
  const source = sourceOfPlay(db, kind, id);
  return source?.kind === "xtream" ? source.id : null;
}
