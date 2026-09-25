import { describe, expect, it } from "vitest";
import { newProfileId, nextColour, pinHash, pinMatches, PROFILE_COLOURS } from "../db/profileIdentity.js";
import type { Profile } from "../db/profiles.js";

const profile = (over: Partial<Profile> = {}): Profile => ({ id: "kid1", name: "Kid", colour: 0, avatar: null, pin: null, position: 0, ...over });

describe("pinHash", () => {
  it("is deterministic and differs per profile id, so the same digits don't match another profile", () => {
    expect(pinHash("kid1", "1234")).toBe(pinHash("kid1", "1234"));
    expect(pinHash("kid1", "1234")).not.toBe(pinHash("kid2", "1234"));
  });

  it("pinMatches only accepts the right digits for a locked profile, and rejects an unlocked one", () => {
    const locked = profile({ pin: pinHash("kid1", "1234") });
    expect(pinMatches(locked, "1234")).toBe(true);
    expect(pinMatches(locked, "0000")).toBe(false);
    expect(pinMatches(profile({ pin: null }), "1234")).toBe(false);
  });
});

describe("nextColour", () => {
  it("picks the first colour nobody has, then wraps once every colour is taken", () => {
    expect(nextColour([])).toBe(0);
    expect(nextColour([profile({ colour: 0 })])).toBe(1);
    const everyColour = PROFILE_COLOURS.map((_, index) => profile({ id: `p${index}`, colour: index }));
    expect(nextColour(everyColour)).toBe(everyColour.length % PROFILE_COLOURS.length);
  });
});

describe("newProfileId", () => {
  it("returns distinct, sync-key-safe ids", () => {
    const a = newProfileId();
    const b = newProfileId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-z0-9]+$/);
  });
});
