import { describe, expect, it } from "vitest";
import { isWatched, shouldPromptResume } from "../db/progressQueries.js";

describe("isWatched", () => {
  it("is true at or past 95% of duration", () => {
    expect(isWatched(950, 1000)).toBe(true);
    expect(isWatched(949, 1000)).toBe(false);
  });

  it("is false with no duration", () => {
    expect(isWatched(500, null)).toBe(false);
    expect(isWatched(500, undefined)).toBe(false);
  });
});

describe("shouldPromptResume", () => {
  it("is false below the 30s floor", () => {
    expect(shouldPromptResume(29, 1000)).toBe(false);
  });

  it("is true between the floor and the watched threshold", () => {
    expect(shouldPromptResume(30, 1000)).toBe(true);
    expect(shouldPromptResume(500, 1000)).toBe(true);
  });

  it("is false at or past the watched threshold", () => {
    expect(shouldPromptResume(950, 1000)).toBe(false);
  });

  it("is false with no duration", () => {
    expect(shouldPromptResume(500, null)).toBe(false);
  });
});
