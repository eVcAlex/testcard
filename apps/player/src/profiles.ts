import { profileKeyPrefix } from "@testcard/sync-schema";

export const MAIN_PROFILE = "main";

export interface WebProfile {
  readonly id: string;
  readonly name: string;
  readonly colour: number;
  readonly avatar: string | null;
  /** A hash of the PIN, or null. */
  readonly pin: string | null;
  readonly position: number;
}

/** The avatar colours, in the order the apps give them out. */
export const PROFILE_COLOURS = ["#e7d2ad", "#7fb8a4", "#e28a6d", "#8fa7e0", "#d7a3d8", "#e3c85c", "#9ccf6e", "#f0a3b5"];

/** The apps' PIN hash (`pinHash` in core's profileIdentity): a PIN made on a TV unlocks here. Kept in step by a test. */
export function pinHash(profileId: string, digits: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${profileId}:${digits}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The avatars the apps offer; a profile stores the id. */
export const AVATARS: Readonly<Record<string, string>> = {
  fox: "🦊", panda: "🐼", tiger: "🐯", lion: "🦁", dog: "🐶", cat: "🐱", frog: "🐸", monkey: "🐵", koala: "🐨", penguin: "🐧", owl: "🦉", unicorn: "🦄",
  octopus: "🐙", whale: "🐳", dino: "🦖", alien: "👽", robot: "🤖", rocket: "🚀", football: "⚽", game: "🎮", guitar: "🎸", popcorn: "🍿", star: "⭐", rainbow: "🌈",
};

export const profileColour = (profile: Pick<WebProfile, "colour">): string => PROFILE_COLOURS[profile.colour % PROFILE_COLOURS.length] ?? "#e7d2ad";
/** The avatar's picture, or the first letter of the name. */
export const profileGlyph = (profile: Pick<WebProfile, "name" | "avatar">): string => (profile.avatar !== null ? AVATARS[profile.avatar] : undefined) ?? (profile.name.trim().charAt(0).toUpperCase() || "?");

export const pinMatches = (profile: WebProfile, digits: string): boolean => profile.pin !== null && profile.pin === pinHash(profile.id, digits);

/** The key prefix a profile's own favourites, recents and progress sync under; Main's have none. */
export const prefixOf = (profileId: string): string => (profileId === MAIN_PROFILE ? "" : profileKeyPrefix(profileId));
