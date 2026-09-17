import { describe, expect, it } from "vitest";
import { SyncPullResponseSchema, SyncPushRequestSchema, SyncSourceSchema } from "./index.js";

describe("SyncSourceSchema", () => {
  it("accepts a fully-populated source row", () => {
    const parsed = SyncSourceSchema.parse({
      remoteKey: "abc123",
      label: "My Provider",
      credentialsBlob: "base64ciphertext",
      credentialsIv: "base64iv",
      updatedAt: 1_700_000_000_000,
      deletedAt: null,
    });
    expect(parsed.label).toBe("My Provider");
  });

  it("rejects a row missing credentialsIv", () => {
    expect(() =>
      SyncSourceSchema.parse({
        remoteKey: "abc123",
        label: "My Provider",
        credentialsBlob: "base64ciphertext",
        updatedAt: 1_700_000_000_000,
        deletedAt: null,
      }),
    ).toThrow();
  });
});

describe("SyncPullResponseSchema", () => {
  it("accepts an empty-but-well-formed response", () => {
    const parsed = SyncPullResponseSchema.parse({
      sources: [],
      movieFavourites: [],
      movieRecents: [],
      seriesFavourites: [],
      seriesRecents: [],
      progress: [],
      serverCursor: 1_700_000_000_000,
    });
    expect(parsed.serverCursor).toBe(1_700_000_000_000);
  });
});

describe("SyncPushRequestSchema", () => {
  it("accepts a progress row with a null duration (unknown length)", () => {
    const parsed = SyncPushRequestSchema.parse({
      sources: [],
      movieFavourites: [],
      movieRecents: [],
      seriesFavourites: [],
      seriesRecents: [],
      progress: [
        {
          remoteKey: "movie:xyz",
          itemType: "movie",
          positionSecs: 120,
          durationSecs: null,
          watched: false,
          updatedAt: 1_700_000_000_000,
          deletedAt: null,
        },
      ],
    });
    expect(parsed.progress[0]?.itemType).toBe("movie");
  });
});
