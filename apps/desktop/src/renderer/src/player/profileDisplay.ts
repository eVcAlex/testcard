import type { Profile } from "@testcard/core";

/**
 * How a profile looks, kept in step by hand with core's `db/profileIdentity.ts` (the source of
 * truth main uses). The renderer can't import that module at runtime — it pulls in better-sqlite3,
 * which doesn't exist in a browser context — so the ids, glyphs and colours are copied here. Only
 * ids and colour indices are ever synced, so a mismatch here would just show the wrong picture, not
 * break anything.
 */
/** Matches core's `MAIN_PROFILE` — the account's own profile, always present and never deletable. */
export const MAIN_PROFILE_ID = "main";

export const PROFILE_COLOURS: readonly string[] = ["#e7d2ad", "#7fb8a4", "#e28a6d", "#8fa7e0", "#d7a3d8", "#e3c85c", "#9ccf6e", "#f0a3b5"];

export const profileColour = (profile: Pick<Profile, "colour">) => PROFILE_COLOURS[profile.colour % PROFILE_COLOURS.length] ?? "#e7d2ad";

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
