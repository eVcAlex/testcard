import type Database from "better-sqlite3";

/**
 * The people who watch on this TV. Each has their own Continue watching, favourites, Home pins, and caption and
 * audio settings (see core's `db/profileSwap.ts` for how their rows are kept apart). The account's own profile is
 * `MAIN_PROFILE`: it is the only one that syncs, and it cannot be deleted. The list itself is this TV's, not synced.
 */
export interface Profile {
  readonly id: string;
  readonly name: string;
  /** Index into PROFILE_COLOURS. */
  readonly colour: number;
  /** A hash of the profile's 4-digit PIN (see `pinHash`), or null for none. A lock against the children, not a secret. */
  readonly pin: string | null;
}

export const MAIN_PROFILE = "main";

/** The avatar colours, in the order new profiles take them. */
export const PROFILE_COLOURS: readonly string[] = ["#e7d2ad", "#7fb8a4", "#e28a6d", "#8fa7e0", "#d7a3d8", "#e3c85c"];

export const profileColour = (profile: Profile) => PROFILE_COLOURS[profile.colour % PROFILE_COLOURS.length] ?? "#e7d2ad";

/** The `schema_meta` keys that are a profile's own and move with it. */
export const PROFILE_META_KEYS: readonly string[] = ["ui:captions", "ui:audio"];

const LIST_KEY = "ui:profiles";
const ACTIVE_KEY = "ui:profile";

const DEFAULT_PROFILES: readonly Profile[] = [{ id: MAIN_PROFILE, name: "Main", colour: 0, pin: null }];

function readMeta(db: Database.Database, key: string): string | undefined {
  try {
    return (db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(key) as { value: string } | undefined)?.value;
  } catch {
    return undefined;
  }
}

function writeMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(key, value);
}

export function readProfiles(db: Database.Database): readonly Profile[] {
  const raw = readMeta(db, LIST_KEY);
  if (raw === undefined) return DEFAULT_PROFILES;
  try {
    const list = (JSON.parse(raw) as Profile[]).filter((entry) => typeof entry.id === "string" && typeof entry.name === "string");
    // The account's own profile is always there, first.
    const main = list.find((entry) => entry.id === MAIN_PROFILE) ?? DEFAULT_PROFILES[0]!;
    return [main, ...list.filter((entry) => entry.id !== MAIN_PROFILE)];
  } catch {
    return DEFAULT_PROFILES;
  }
}

export function writeProfiles(db: Database.Database, profiles: readonly Profile[]): void {
  writeMeta(db, LIST_KEY, JSON.stringify(profiles));
}

/** The profile whose rows are in the tables now. */
export function readActiveProfile(db: Database.Database): string {
  return readMeta(db, ACTIVE_KEY) ?? MAIN_PROFILE;
}

export function writeActiveProfile(db: Database.Database, id: string): void {
  writeMeta(db, ACTIVE_KEY, id);
}

/** A new profile's id: not a name, which can change. */
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
