import type Database from "better-sqlite3";
import { remoteKeyFor } from "../sync/remoteKey.js";
import { yieldToEventLoop } from "./applyInSlices.js";

/**
 * The key on the account of each title in a refresh (a digest of the provider's host and the title's id). Titles this
 * device already has keep the key stored with them: working out tens of thousands again on every refresh took most of
 * its time on a Fire TV. Those are trusted only if one of them, worked out afresh, still matches (the source's
 * identity host has not changed since); otherwise every key is worked out again.
 */
export async function keysFor(
  db: Database.Database,
  table: "movies" | "series",
  sourceId: string,
  providerHost: string,
  pages: readonly (readonly { id: string; providerId: string }[])[],
): Promise<Map<string, string>> {
  // Android's SQLite adapter stores a NUL in an id as U+0001; ids here are compared as the importer writes them.
  const stored = new Map<string, string>();
  for (const row of db.prepare(`SELECT id, remote_key AS remoteKey FROM ${table} WHERE source_id = ? AND remote_key IS NOT NULL`).all(sourceId) as { id: string; remoteKey: string }[]) {
    stored.set(row.id.replaceAll("\u0001", "\0"), row.remoteKey);
  }
  let trusted = false;
  const sample = pages.flat().find((item) => stored.has(item.id));
  if (sample !== undefined) trusted = (await remoteKeyFor(providerHost, sample.providerId)) === stored.get(sample.id);

  const keys = new Map<string, string>();
  for (const page of pages) {
    const missing = trusted ? page.filter((item) => !stored.has(item.id)) : page;
    if (trusted) for (const item of page) if (stored.has(item.id)) keys.set(item.id, stored.get(item.id)!);
    if (missing.length === 0) continue;
    // A page's digests at once rather than one await per title; a macrotask between pages lets the screen draw.
    const computed = await Promise.all(missing.map((item) => remoteKeyFor(providerHost, item.providerId)));
    missing.forEach((item, index) => keys.set(item.id, computed[index]!));
    await yieldToEventLoop();
  }
  return keys;
}
