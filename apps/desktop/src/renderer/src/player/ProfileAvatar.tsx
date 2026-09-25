import type { Profile } from "@testcard/core";
import { avatarGlyph, profileColour } from "./profileDisplay.js";

/** A profile's disc: its colour, and its chosen avatar or the first letter of its name. */
export function ProfileAvatar({ profile, size = 32 }: { profile: Pick<Profile, "name" | "colour" | "avatar">; size?: number }) {
  const glyph = avatarGlyph(profile);
  return (
    <span
      className="pw-profile-avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.56), background: profileColour(profile) }}
    >
      {glyph ?? (profile.name.trim().charAt(0).toUpperCase() || "?")}
    </span>
  );
}
