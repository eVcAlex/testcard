import type Database from "better-sqlite3";
import { listProfiles, MAIN_PROFILE, saveProfile, type Profile } from "./profiles.js";

/**
 * How a profile is presented and picked — shared by every app so a profile made on one looks and
 * unlocks the same on another (see `db/profiles.ts` for the profile record itself).
 */

/** The avatar colours, in the order new profiles take them. */
export const PROFILE_COLOURS: readonly string[] = ["#e7d2ad", "#7fb8a4", "#e28a6d", "#8fa7e0", "#d7a3d8", "#e3c85c", "#9ccf6e", "#f0a3b5"];

export const profileColour = (profile: Pick<Profile, "colour">) => PROFILE_COLOURS[profile.colour % PROFILE_COLOURS.length] ?? "#e7d2ad";

/** The avatars to choose from, drawn on the profile's colour. Ids are stored and synced, so they never change. */
export const AVATARS: readonly { readonly id: string; readonly glyph: string }[] = [
  { id: "fox", glyph: "🦊" },
  { id: "panda", glyph: "🐼" },
  { id: "tiger", glyph: "🐯" },
  { id: "lion", glyph: "🦁" },
  { id: "dog", glyph: "🐶" },
  { id: "cat", glyph: "🐱" },
  { id: "frog", glyph: "🐸" },
  { id: "monkey", glyph: "🐵" },
  { id: "koala", glyph: "🐨" },
  { id: "penguin", glyph: "🐧" },
  { id: "owl", glyph: "🦉" },
  { id: "unicorn", glyph: "🦄" },
  { id: "octopus", glyph: "🐙" },
  { id: "whale", glyph: "🐳" },
  { id: "dino", glyph: "🦖" },
  { id: "alien", glyph: "👽" },
  { id: "robot", glyph: "🤖" },
  { id: "rocket", glyph: "🚀" },
  { id: "football", glyph: "⚽" },
  { id: "game", glyph: "🎮" },
  { id: "guitar", glyph: "🎸" },
  { id: "popcorn", glyph: "🍿" },
  { id: "star", glyph: "⭐" },
  { id: "rainbow", glyph: "🌈" },
];

export const avatarGlyph = (profile: Pick<Profile, "avatar">) => AVATARS.find((entry) => entry.id === profile.avatar)?.glyph ?? null;

/** The `schema_meta` keys that are a profile's own and move with it (TV-only settings; desktop has none yet). */
export const PROFILE_META_KEYS: readonly string[] = ["ui:captions", "ui:audio"];

const ACTIVE_KEY = "ui:profile";
/** Where builds before profiles synced kept their list, on the TV alone. */
const OLD_LIST_KEY = "ui:profiles";

/** The account's profiles, taking in (once) any made on this device before profiles synced. */
export function readProfiles(db: Database.Database): readonly Profile[] {
  try {
    const old = db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(OLD_LIST_KEY) as { value: string } | undefined;
    if (old !== undefined) {
      const known = new Set(listProfiles(db).map((profile) => profile.id));
      (JSON.parse(old.value) as { id: string; name: string; colour: number; pin: string | null }[]).forEach((entry, index) => {
        if (entry.id !== MAIN_PROFILE && !known.has(entry.id)) saveProfile(db, { id: entry.id, name: entry.name, colour: entry.colour, avatar: null, pin: entry.pin, position: index });
        else if (entry.id === MAIN_PROFILE && (entry.name !== "Main" || entry.pin !== null)) saveProfile(db, { id: MAIN_PROFILE, name: entry.name, colour: entry.colour, avatar: null, pin: entry.pin, position: 0 });
      });
      db.prepare(`DELETE FROM schema_meta WHERE key = ?`).run(OLD_LIST_KEY);
    }
  } catch {
    // An unreadable old list is dropped; Main is always there.
  }
  return listProfiles(db);
}

/** The profile whose rows are in the tables now. */
export function readActiveProfile(db: Database.Database): string {
  try {
    return (db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(ACTIVE_KEY) as { value: string } | undefined)?.value ?? MAIN_PROFILE;
  } catch {
    return MAIN_PROFILE;
  }
}

export function writeActiveProfile(db: Database.Database, id: string): void {
  db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(ACTIVE_KEY, id);
}

/** A new profile's id: not a name, which can change. Letters and digits only (it is part of the sync keys). */
export const newProfileId = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** The colour a new profile takes: the first one nobody has, else round again. */
export function nextColour(profiles: readonly Profile[]): number {
  const taken = new Set(profiles.map((entry) => entry.colour % PROFILE_COLOURS.length));
  const free = PROFILE_COLOURS.findIndex((_, index) => !taken.has(index));
  return free === -1 ? profiles.length % PROFILE_COLOURS.length : free;
}

/** FNV-1a over the profile's id and the digits, so the same PIN on two profiles is stored differently. */
export function pinHash(profileId: string, digits: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${profileId}:${digits}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export const pinMatches = (profile: Profile, digits: string) => profile.pin !== null && profile.pin === pinHash(profile.id, digits);
