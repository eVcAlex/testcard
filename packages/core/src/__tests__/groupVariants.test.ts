import { describe, expect, it } from "vitest";
import { groupVariants, type RawChannelEntry } from "../normalise/groupVariants.js";

function entry(rawName: string, providerStreamId: string): RawChannelEntry {
  return { sourceId: "src1", categoryId: "cat1", providerStreamId, rawName };
}

describe("groupVariants", () => {
  it("collapses the seven TNT Sports 1 quality variants seen from the real provider into one channel", () => {
    const entries = [
      entry("TNT Sports 1 (1080p50)", "1"),
      entry("TNT Sports 1 (1080p25)", "2"),
      entry("TNT Sports 1 (1080p25)", "3"), // provider genuinely lists this twice
      entry("TNT Sports 1 (720p25)", "4"),
      entry("TNT Sports 1 (720p25)", "5"),
      entry("TNT Sports 1 (576p25)", "6"),
      entry("TNT Sports 1 (480p25)", "7"),
    ];

    const channels = groupVariants(entries);

    expect(channels).toHaveLength(1);
    expect(channels[0]?.variants).toHaveLength(7);
  });

  it("orders variants best quality first", () => {
    const entries = [entry("Ch (480p25)", "1"), entry("Ch (1080p50)", "2"), entry("Ch (720p25)", "3")];
    const [channel] = groupVariants(entries);
    expect(channel?.variants.map((v) => v.quality)).toEqual(["1080p50", "720p25", "480p25"]);
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

  it("produces a stable id across two independent calls with the same input, for refresh matching", () => {
    const entries = [entry("TNT Sports 1 (1080p50)", "1")];
    const first = groupVariants(entries)[0]?.id;
    const second = groupVariants(entries)[0]?.id;
    expect(first).toBe(second);
  });
});
