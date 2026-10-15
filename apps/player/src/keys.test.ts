import { describe, expect, it } from "vitest";
import { channelKeyFor } from "@testcard/core/src/sync/channelHistory.ts";
import { pinHash as appsPinHash } from "@testcard/core/src/db/profileIdentity.ts";
import { channelKey } from "./keys.ts";
import { pinHash } from "./profiles.ts";

describe("keys the apps also compute", () => {
  it("builds a channel's key from the source's key and the provider's stream id", () => {
    expect(channelKey("abc123", "42")).toBe(channelKeyFor("abc123", "some-device-id", "some-device-id:42"));
  });
  it("hashes a PIN as the apps do", () => {
    for (const [id, digits] of [["main", "1234"], ["p1abc", "0000"], ["pkx9", "98765"]] as const) expect(pinHash(id, digits)).toBe(appsPinHash(id, digits));
  });
});
