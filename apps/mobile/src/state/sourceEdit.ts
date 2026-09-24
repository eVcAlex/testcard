import type Database from "better-sqlite3";
import { extractXtreamCredentials, probeXtream, type XtreamCredentials } from "@testcard/core/src/source/xtream/detect.js";
import { remoteKeyFor, remoteKeyForPlaylist } from "@testcard/core/src/sync/remoteKey.js";
import { applySourceContent } from "@testcard/core/src/sync/sourceContent.js";
import { parseBackupUrls } from "@testcard/core/src/sync/localChanges.js";
import type { SourceContent } from "@testcard/sync-schema";
import { getStoredCredentials as getCredentials, saveCredentials } from "../platform/secrets";

/**
 * Adding and editing a source on the TV, as the desktop app's source form does: the login is checked with the
 * provider before it is kept, and the change syncs to the account's other devices.
 */

/** A source as the form edits it. `password` is blank while editing unless a new one is typed. */
export interface SourceDraft {
  readonly kind: "xtream" | "m3u";
  readonly name: string;
  readonly server: string;
  readonly username: string;
  readonly password: string;
  /** A playlist link; for a new source, a whole Xtream `get.php` link is taken as its login. */
  readonly playlistUrl: string;
  readonly epgUrl: string;
  /** Xtream: other server addresses for the same account, comma or space separated as typed. */
  readonly backupUrls: string;
  readonly content: SourceContent;
}

export const emptyDraft = (kind: SourceDraft["kind"]): SourceDraft => ({
  kind,
  name: "",
  server: "",
  username: "",
  password: "",
  playlistUrl: "",
  epgUrl: "",
  backupUrls: "",
  content: { live: true, movies: true, series: true },
});

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

/** Just the scheme and host of a server address, so a whole pasted provider link still works. */
function serverAddress(input: string): string {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
  } catch {
    throw new Error("That's not a server address.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("A server address starts with http:// or https://.");
  return `${parsed.protocol}//${parsed.host}`;
}

async function checkLogin(credentials: XtreamCredentials): Promise<void> {
  const result = await probeXtream(credentials).catch(() => {
    throw new Error("Couldn't reach that server. Check the address.");
  });
  if (!result.authenticated) throw new Error("The provider turned down that username and password.");
}

async function checkPlaylist(input: string): Promise<string> {
  const url = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That's not a playlist link.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("A playlist link starts with http:// or https://.");
  const response = await fetch(url).catch(() => {
    throw new Error("Couldn't reach that playlist. Check the link.");
  });
  void response.body?.cancel().catch(() => undefined);
  if (!response.ok) throw new Error(`The playlist link answered with HTTP ${response.status}.`);
  return url;
}

function checkGuide(input: string): string | null {
  const url = input.trim();
  if (url === "") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
  } catch {
    // falls through
  }
  throw new Error("The TV guide address must be a link starting with http:// or https://.");
}

export interface SavedSource {
  readonly id: string;
  /** The login, link or content switched on changed: its channels and titles are loaded again. */
  readonly reload: boolean;
}


/** Checks and keeps a new source (`sourceId` undefined) or a change to one. Throws a message fit to show. */
export async function saveSource(db: Database.Database, sourceId: string | undefined, draft: SourceDraft, newId: () => string): Promise<SavedSource> {
  const name = draft.name.trim();
  if (name === "") throw new Error("Give the source a name.");
  if (!draft.content.live && !draft.content.movies && !draft.content.series) throw new Error("Choose at least one of Live TV, Movies and Series.");
  const epg = checkGuide(draft.epgUrl);
  const backups = JSON.stringify(
    [...new Set(draft.backupUrls.split(/[\s,]+/).filter((entry) => entry !== "").map((entry) => {
      try {
        return serverAddress(entry);
      } catch {
        throw new Error(`"${entry}" is not a server address.`);
      }
    }))],
  );
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
