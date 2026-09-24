import type Database from "better-sqlite3";
import { profileKeyPrefix } from "@testcard/sync-schema";
import { forgetProfile } from "./profileSwap.js";

/**
 * The people who watch, as the account knows them (synced, encrypted): see `docs/adr/0011-tv-profiles.md`.
 * `MAIN_PROFILE` is the account's own. It always exists and cannot be deleted; its rows sync under the keys they
 * always had, so a device that knows nothing of profiles (the desktop app) sees only Main's history.
 */
export const MAIN_PROFILE = "main";

export interface Profile {
  readonly id: string;
  readonly name: string;
  readonly colour: number;
  readonly avatar: string | null;
  /** A hash of the PIN (the app's), or null. */
  readonly pin: string | null;
  readonly position: number;
}

interface ProfileRow {
  readonly id: string;
  readonly name: string;
  readonly colour: number;
  readonly avatar: string | null;
  readonly pin: string | null;
  readonly position: number;
}

/** Every profile, Main first, then in the order they were added. Main is created (unsynced, clock 0) if missing. */
export function listProfiles(db: Database.Database): Profile[] {
  db.prepare(`INSERT OR IGNORE INTO profiles (id, name, colour, position, updated_at) VALUES (?, 'Main', 0, 0, 0)`).run(MAIN_PROFILE);
  const rows = db.prepare(`SELECT id, name, colour, avatar, pin, position FROM profiles WHERE deleted_at IS NULL ORDER BY id != ?, position, rowid`).all(MAIN_PROFILE) as ProfileRow[];
  return rows.map((row) => ({ ...row }));
}

/** Adds or changes a profile, stamped now so the change syncs. */
export function saveProfile(db: Database.Database, profile: Profile): void {
  db.prepare(
    `INSERT INTO profiles (id, name, colour, avatar, pin, position, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, colour = excluded.colour, avatar = excluded.avatar, pin = excluded.pin,
       position = excluded.position, updated_at = excluded.updated_at, deleted_at = NULL`,
  ).run(profile.id, profile.name, profile.colour, profile.avatar, profile.pin, profile.position, Date.now());
}

/** Deletes a profile everywhere (a tombstone syncs) and its rows on this device. Never Main. */
export function deleteProfile(db: Database.Database, id: string): void {
  if (id === MAIN_PROFILE) return;
  const now = Date.now();
  db.prepare(`UPDATE profiles SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
  forgetProfile(db, id);
}

/** The remote-key prefix of the profile's own rows ("" for Main). */
export const keyPrefix = (profileId: string) => (profileId === MAIN_PROFILE ? "" : profileKeyPrefix(profileId));
