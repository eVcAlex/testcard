/**
 * The people who watch. The list is the account's (core's `db/profiles.ts`, synced and encrypted), so a profile made
 * on one TV is on the others. Each has their own Continue watching, favourites, recents and progress (synced too),
 * and on each TV their own Home pins and caption and audio settings (see core's `db/profileSwap.ts`). The avatar
 * set, colours and PIN hashing live in core too (`db/profileIdentity.ts`), so the desktop app agrees with the TV.
 */
// Deep imports on purpose, not the "@testcard/core" barrel: that barrel also re-exports
// db/openDatabase.ts, which pulls in the real (Node-native) better-sqlite3 package. Metro has no
// tree-shaking for it, so importing the barrel here drags "fs" into the Android JS bundle and
// fails the build ("Unable to resolve module fs").
export { MAIN_PROFILE, type Profile } from "@testcard/core/src/db/profiles.js";
export {
  AVATARS,
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
} from "@testcard/core/src/db/profileIdentity.js";
