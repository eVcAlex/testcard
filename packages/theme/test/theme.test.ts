import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cssFor, dark, light, tv, tvColors } from "../src/index.ts";

describe("theme", () => {
  it("colors.css on disk is exactly what the generator produces", () => {
    expect(readFileSync(new URL("../colors.css", import.meta.url), "utf8")).toBe(cssFor());
  });

  it("the TV override only changes keys the base palette has, and only neutrals", () => {
    const neutrals = ["background", "surface-sunken", "surface-raised", "card", "card-active", "border"];
    for (const key of Object.keys(tv)) {
      expect(Object.keys(dark)).toContain(key);
      expect(neutrals).toContain(key);
    }
  });

  it("the light theme only overrides keys the base palette has", () => {
    for (const key of Object.keys(light)) expect(Object.keys(dark)).toContain(key);
  });

  it("tvColors keeps the TV's darker neutrals and shares the accent", () => {
    expect(tvColors.background).toBe("#0a0d11");
    expect(tvColors.accent).toBe(dark.accent);
    expect(tvColors.foreground).toBe(dark.foreground);
    expect(tvColors.accentSoft).toBe("#e7d2ad26");
  });
});
