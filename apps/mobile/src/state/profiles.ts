/**
 * The people who watch. The list is the account's (core's `db/profiles.ts`, synced and encrypted), so a profile made
 * on one TV is on the others. Each has their own Continue watching, favourites, recents and progress (synced too),
 * and on each TV their own Home pins and caption and audio settings (see core's `db/profileSwap.ts`). The avatar
 * set, colours and PIN hashing live in core too (`db/profileIdentity.ts`), so the desktop app agrees with the TV.
 */
export {
  AVATARS,
  MAIN_PROFILE,
  PROFILE_COLOURS,
  PROFILE_META_KEYS,
  avatarGlyph,
  newProfileId,
  nextColour,
  pinHash,
  pinMatches,
  profileColour,
  readActiveProfile,
  readProfiles,
  writeActiveProfile,
  type Profile,
} from "@testcard/core";
