import { describe, expect, it } from "vitest";
import { groupVariants, type RawChannelEntry } from "../normalise/groupVariants.js";

function entry(rawName: string, providerStreamId: string): RawChannelEntry {
  return { sourceId: "src1", categoryId: "cat1", providerStreamId, rawName };
}

describe("groupVariants", () => {
  it("lists each quality the provider offers as its own channel, best first", () => {
    const entries = [
      entry("TNT Sports 1 (720p25)", "4"),
      entry("TNT Sports 1 (1080p50)", "1"),
      entry("TNT Sports 1 (1080p25)", "2"),
      entry("TNT Sports 1 (1080p25)", "3"), // provider genuinely lists this twice
      entry("TNT Sports 1 (576p25)", "6"),
    ];

    const channels = groupVariants(entries);

    expect(channels.map((c) => c.normalisedName).sort()).toEqual([
      "TNT Sports 1 (1080p25)",
      "TNT Sports 1 (1080p50)",
      "TNT Sports 1 (576p25)",
      "TNT Sports 1 (720p25)",
    ]);
    // The same name listed twice is one channel with two streams to try.
    expect(channels.find((c) => c.normalisedName === "TNT Sports 1 (1080p25)")?.variants).toHaveLength(2);
  });

  it("keeps the old id on the best quality, so a favourite of the merged channel still finds it", () => {
    const merged = "channel:src1\u0000cat1\u0000TNT Sports 1\u0000";
    const channels = groupVariants([entry("TNT Sports 1 (720p25)", "1"), entry("TNT Sports 1 (1080p50)", "2")]);
    expect(channels.find((c) => c.id === merged)?.normalisedName).toBe("TNT Sports 1 (1080p50)");
    expect(new Set(channels.map((c) => c.id)).size).toBe(2);
  });

  it("lists names that differ only in styled tags apart", () => {
    const channels = groupVariants([entry("UK| Sky Sports Main Event ᵁᴴᴰ", "1"), entry("UK| Sky Sports Main Event", "2")]);
    expect(channels.map((c) => c.normalisedName)).toEqual(["Sky Sports Main Event UHD", "Sky Sports Main Event"]);
  });

  it("gives every quality the family's guide id when its own entry has none", () => {
    const channels = groupVariants([entry("Ch (720p25)", "1"), { ...entry("Ch (1080p50)", "2"), tvgId: "ch.uk" }]);
    expect(channels.map((c) => c.tvgId)).toEqual(["ch.uk", "ch.uk"]);
  });

  it("keeps different channels in the same category separate", () => {
    const entries = [entry("TNT Sports 1 (1080p50)", "1"), entry("TNT Sports 2 (1080p50)", "2")];
    expect(groupVariants(entries)).toHaveLength(2);
  });

  it("marks an (OFFLINE) variant without merging it into the live variant's quality", () => {
    const entries = [entry("TNT Sports Ultimate (1080p50)", "1"), entry("TNT Sports Ultimate (OFFLINE)", "2")];
    const [channel] = groupVariants(entries);
    expect(channel?.variants.some((v) => v.isOffline)).toBe(true);
    expect(channel?.variants.some((v) => !v.isOffline)).toBe(true);
  });

  it("gives channels in different categories distinct ids even with an identical name", () => {
    const a = groupVariants([{ ...entry("Same Name", "1"), categoryId: "catA" }]);
    const b = groupVariants([{ ...entry("Same Name", "2"), categoryId: "catB" }]);
    expect(a[0]?.id).not.toBe(b[0]?.id);
  });

  it("gives the same stream URL distinct variant ids when it lands in two different channels", () => {
    // Playlists list the same channel (same URL) under several group-titles; each becomes a
    // separate channel here, and the variant ids must not collide (a UNIQUE column downstream).
    const a = groupVariants([{ ...entry("Sky Sports", "http://cdn/x.ts"), categoryId: "catA" }]);
    const b = groupVariants([{ ...entry("Sky Sports", "http://cdn/x.ts"), categoryId: "catB" }]);
    expect(a[0]?.variants[0]?.id).not.toBe(b[0]?.variants[0]?.id);
  });

  it("dedupes a variant listed twice with an identical URL in one group", () => {
    const entries = [entry("Dead Channel", "http://cdn/placeholder.ts"), entry("Dead Channel", "http://cdn/placeholder.ts")];
    const [channel] = groupVariants(entries);
    expect(channel?.variants).toHaveLength(1);
  });

  it("takes the first non-empty tvg-id across a channel's variants", () => {
    // The provider left tvg-id blank on the first-listed copy and set it on a later one.
    const entries: RawChannelEntry[] = [
      { ...entry("TNT Sports 1 (1080p50)", "1") },
      { ...entry("TNT Sports 1 (1080p50)", "2"), tvgId: "tnt.sports.1.uk" },
    ];
    const [channel] = groupVariants(entries);
    expect(channel?.tvgId).toBe("tnt.sports.1.uk");
  });

  it("produces a stable id across two independent calls with the same input, for refresh matching", () => {
    const entries = [entry("TNT Sports 1 (1080p50)", "1")];
    const first = groupVariants(entries)[0]?.id;
    const second = groupVariants(entries)[0]?.id;
    expect(first).toBe(second);
  });
});
