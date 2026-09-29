import { describe, expect, it } from "vitest";
import { guideFileName, isSharableGuideUrl } from "./guide.js";

describe("isSharableGuideUrl", () => {
  it("accepts a plain https guide file", () => {
    expect(isSharableGuideUrl("https://github.com/x/y/raw/refs/heads/main/epg6.xml.gz")).toBe(true);
    expect(isSharableGuideUrl("https://example.com/guide.xml")).toBe(true);
  });
  it("refuses anything carrying a login or not a public guide file", () => {
    for (const bad of [
      "http://example.com/guide.xml",
      "https://user:pw@example.com/guide.xml",
      "https://example.com/xmltv.php?username=a&password=b",
      "https://example.com/guide.xml#x",
      "https://example.com/guide.html",
      "https://localhost/guide.xml",
      "https://10.0.0.5/guide.xml",
      "https://[::1]/guide.xml",
      "not a url",
      `https://example.com/${"a".repeat(600)}.xml`,
    ]) expect(isSharableGuideUrl(bad), bad).toBe(false);
  });
});

describe("guideFileName", () => {
  it("is stable and file-name safe", async () => {
    const a = await guideFileName("https://example.com/guide.xml");
    expect(a).toMatch(/^guide-[0-9a-f]{32}\.json$/);
    expect(await guideFileName("https://example.com/guide.xml")).toBe(a);
    expect(await guideFileName("https://example.com/other.xml")).not.toBe(a);
  });
});
