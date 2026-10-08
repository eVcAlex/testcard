import { NOT_FOUND_META, ROUTES, faqPageLd, headModel, homeLd, metaFor, serialiseLd } from "./routes-meta.ts";

const tag = (m: ReturnType<typeof headModel>, key: string) => m.tags.find((t) => t.attrs.name === key || t.attrs.property === key || t.attrs.rel === key)?.attrs;

describe("routes-meta", () => {
  it("uses the spec titles", () => {
    expect(metaFor("/").title).toBe("Testcard IPTV player for Windows & Fire TV | by Evicted");
    expect(metaFor("/download").title).toBe("Testcard IPTV player: beta for Windows & Fire TV");
    expect(metaFor("/setup").title).toBe("Add Xtream or M3U sources to Testcard: setup guide");
    expect(metaFor("/faq").title).toBe("Testcard IPTV player FAQ: EPG, sources, legality");
  });

  it("gives every route a unique title and a description of a sensible length", () => {
    const all = [...ROUTES, NOT_FOUND_META];
    expect(new Set(all.map((r) => r.title)).size).toBe(all.length);
    for (const r of all) {
      expect(r.description.length).toBeGreaterThan(40);
      expect(r.description.length).toBeLessThanOrEqual(170);
    }
  });

  it("normalises trailing slashes and sends unknown paths to the 404", () => {
    expect(metaFor("/faq/")).toBe(metaFor("/faq"));
    expect(metaFor("/nope")).toBe(NOT_FOUND_META);
  });

  it("builds canonical, Open Graph and Twitter tags", () => {
    const m = headModel(metaFor("/setup"));
    expect(tag(m, "canonical")?.href).toBe("https://evicted.dev/setup");
    expect(tag(m, "og:url")?.content).toBe("https://evicted.dev/setup");
    expect(tag(m, "og:image")?.content).toBe("https://evicted.dev/og.png");
    expect(tag(m, "og:title")?.content).toBe(metaFor("/setup").title);
    expect(tag(m, "twitter:card")?.content).toBe("summary_large_image");
    expect(tag(m, "robots")).toBeUndefined();
    expect(headModel(metaFor("/")).tags.find((t) => t.attrs.rel === "canonical")?.attrs.href).toBe("https://evicted.dev/");
  });

  it("marks /link noindex and the 404 noindex without a canonical", () => {
    expect(tag(headModel(metaFor("/link")), "robots")?.content).toMatch(/noindex/);
    const nf = headModel(NOT_FOUND_META);
    expect(tag(nf, "robots")?.content).toMatch(/noindex/);
    expect(tag(nf, "canonical")).toBeUndefined();
  });

  it("puts Organization, WebSite and SoftwareApplication JSON-LD on / only, free and with no ratings", () => {
    const doc = homeLd()[0] as unknown as { "@graph": { "@type": string; offers?: { price: string } }[] };
    expect(doc["@graph"].map((n) => n["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
    expect(doc["@graph"][2]?.offers?.price).toBe("0");
    expect(JSON.stringify(doc)).not.toMatch(/aggregateRating|review/i);
    expect(headModel(metaFor("/")).jsonLd).toHaveLength(1);
    expect(headModel(metaFor("/download")).jsonLd).toHaveLength(0);
  });

  it("builds FAQPage JSON-LD from question and answer pairs and escapes < in script content", () => {
    const doc = faqPageLd([{ question: "Q?", answer: "A </script> b" }])[0] as unknown as { "@type": string; mainEntity: unknown[] };
    expect(doc["@type"]).toBe("FAQPage");
    expect(doc.mainEntity).toHaveLength(1);
    expect(serialiseLd(doc)).not.toContain("</script>");
    expect(JSON.parse(serialiseLd(doc)).mainEntity[0].acceptedAnswer.text).toBe("A </script> b");
  });
});
