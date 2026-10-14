import type Database from "better-sqlite3";
import { extractXtreamCredentials, probeXtream, type XtreamCredentials } from "@testcard/core/src/source/xtream/detect.js";
import { remoteKeyFor, remoteKeyForPlaylist } from "@testcard/core/src/sync/remoteKey.js";
import { applySourceContent } from "@testcard/core/src/sync/sourceContent.js";
import { parseBackupUrls } from "@testcard/core/src/sync/localChanges.js";
import { checkDraftBasics, emptyDraft, playlistAddress, serverAddress, type SourceDraft } from "@testcard/core/src/sync/sourceDraft.js";
import { getStoredCredentials as getCredentials, saveCredentials } from "../platform/secrets";

/**
 * Adding and editing a source on the TV, as the desktop app's source form does: the login is checked with the
 * provider before it is kept, and the change syncs to the account's other devices. The form rules themselves are
 * shared with the website (`sourceDraft.ts`).
 */

export { emptyDraft, type SourceDraft };

export async function readDraft(db: Database.Database, sourceId: string): Promise<SourceDraft | undefined> {
  const row = db
    .prepare(
      `SELECT kind, name, playlist_url AS playlistUrl, epg_url AS epgUrl, backup_urls AS backupUrls, include_live AS live, include_movies AS movies, include_series AS series
       FROM sources WHERE id = ?`,
    )
    .get(sourceId) as { kind: "xtream" | "m3u"; name: string; playlistUrl: string | null; epgUrl: string | null; backupUrls: string | null; live: number; movies: number; series: number } | undefined;
  if (row === undefined) return undefined;
  const login = row.kind === "xtream" ? await getCredentials(sourceId).catch(() => undefined) : undefined;
  return {
    kind: row.kind,
    name: row.name,
    server: login?.baseUrl ?? "",
    username: login?.username ?? "",
    password: "",
    playlistUrl: row.playlistUrl ?? "",
    epgUrl: row.epgUrl ?? "",
    backupUrls: parseBackupUrls(row.backupUrls).join(", "),
    content: { live: row.live !== 0, movies: row.movies !== 0, series: row.series !== 0 },
  };
}

async function checkLogin(credentials: XtreamCredentials): Promise<void> {
  const result = await probeXtream(credentials).catch(() => {
    throw new Error("Couldn't reach that server. Check the address.");
  });
  if (!result.authenticated) throw new Error("The provider turned down that username and password.");
}

async function checkPlaylist(input: string): Promise<string> {
  const url = playlistAddress(input);
  const response = await fetch(url).catch(() => {
    throw new Error("Couldn't reach that playlist. Check the link.");
  });
  void response.body?.cancel().catch(() => undefined);
  if (!response.ok) throw new Error(`The playlist link answered with HTTP ${response.status}.`);
  return url;
}

export interface SavedSource {
  readonly id: string;
  /** The login, link or content switched on changed: its channels and titles are loaded again. */
  readonly reload: boolean;
}


/** Checks and keeps a new source (`sourceId` undefined) or a change to one. Throws a message fit to show. */
export async function saveSource(db: Database.Database, sourceId: string | undefined, draft: SourceDraft, newId: () => string): Promise<SavedSource> {
  const basics = checkDraftBasics(draft);
  const { name, epgUrl: epg } = basics;
  const backups = JSON.stringify(basics.backups);
  const now = Date.now();

  // A whole Xtream link pasted as a new playlist is an Xtream login.
  const pasted = sourceId === undefined && draft.kind === "m3u" ? extractXtreamCredentials(draft.playlistUrl.trim()) : null;
  const kind = pasted !== null ? "xtream" : draft.kind;

  if (sourceId === undefined) {
    const id = newId();
    if (kind === "xtream") {
      const credentials = pasted ?? { baseUrl: serverAddress(draft.server), username: draft.username.trim(), password: draft.password };
      if (credentials.username === "" || credentials.password === "") throw new Error("Enter the username and password.");
      await checkLogin(credentials);
      await saveCredentials(id, credentials);
      db.prepare(`INSERT INTO sources (id, kind, name, base_url, epg_url, backup_urls, created_at, remote_key, sync_updated_at) VALUES (?, 'xtream', ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        name,
        credentials.baseUrl,
        epg,
        backups,
        now,
        await remoteKeyFor(credentials.baseUrl, "source"),
        now,
      );
    } else {
      const url = await checkPlaylist(draft.playlistUrl);
      db.prepare(`INSERT INTO sources (id, kind, name, playlist_url, epg_url, created_at, remote_key, sync_updated_at) VALUES (?, 'm3u', ?, ?, ?, ?, ?, ?)`).run(
        id,
        name,
        url,
        epg,
        now,
        await remoteKeyForPlaylist(url),
        now,
      );
    }
    applySourceContent(db, id, draft.content);
    return { id, reload: true };
  }

  const row = db.prepare(`SELECT kind, playlist_url AS playlistUrl, remote_key AS remoteKey FROM sources WHERE id = ?`).get(sourceId) as
    | { kind: "xtream" | "m3u"; playlistUrl: string | null; remoteKey: string | null }
    | undefined;
  if (row === undefined) throw new Error("This source was removed.");
  let reload = false;

  if (row.kind === "xtream") {
    const current = await getCredentials(sourceId).catch(() => undefined);
    const credentials: XtreamCredentials = {
      baseUrl: serverAddress(draft.server),
      username: draft.username.trim() || (current?.username ?? ""),
      password: draft.password !== "" ? draft.password : (current?.password ?? ""),
    };
    if (credentials.username === "" || credentials.password === "") throw new Error("Enter the username and password.");
    const changed = current === undefined || credentials.baseUrl !== current.baseUrl || credentials.username !== current.username || credentials.password !== current.password;
    if (changed) {
      await checkLogin(credentials);
      await saveCredentials(sourceId, credentials);
      reload = true;
    }
    // Only the login changes: the source keeps its identity (its key on the account and the address its history is
    // matched by), so a provider that moved keeps its favourites, progress and Continue watching.
    db.prepare(`UPDATE sources SET name = ?, epg_url = ?, backup_urls = ?, sync_updated_at = ? WHERE id = ?`).run(name, epg, backups, now, sourceId);
  } else {
    let url = row.playlistUrl ?? "";
    if (draft.playlistUrl.trim() !== url) {
      if (extractXtreamCredentials(draft.playlistUrl.trim()) !== null) throw new Error("That's an Xtream link. Remove this source and add it again as an Xtream login.");
      url = await checkPlaylist(draft.playlistUrl);
      reload = true;
    }
    // The source keeps its key on the account, so the other devices update it rather than add another.
    db.prepare(`UPDATE sources SET name = ?, playlist_url = ?, epg_url = ?, sync_updated_at = ? WHERE id = ?`).run(name, url, epg, now, sourceId);
  }
  if (applySourceContent(db, sourceId, draft.content)) reload = true;
  return { id: sourceId, reload };
}
