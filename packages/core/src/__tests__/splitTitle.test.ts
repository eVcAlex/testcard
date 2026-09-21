import { describe, expect, it } from "vitest";
import { splitTitle } from "../normalise/splitTitle.js";

describe("splitTitle", () => {
  it("drops the catalogue tag and reads the year", () => {
    expect(splitTitle("4K-TOP - Corina (2025)")).toEqual({ title: "Corina", year: "2025", is4k: true });
  });

  it("drops a country tag that follows the year", () => {
    expect(splitTitle("Dune: Prophecy (2024) (US)")).toEqual({ title: "Dune: Prophecy", year: "2024", is4k: false });
  });

  it("leaves a plain title alone", () => {
    expect(splitTitle("Heat")).toEqual({ title: "Heat", year: null, is4k: false });
  });
});
