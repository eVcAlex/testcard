import { applyHead, headToHtml } from "./head.ts";
import { headModel, metaFor } from "./routes-meta.ts";

describe("head", () => {
  it("renders tags as escaped HTML with the data-head marker", () => {
    const html = headToHtml(headModel(metaFor("/")));
    expect(html).toContain("<title>Testcard IPTV player for Windows &amp; Fire TV | by Evicted</title>");
    expect(html).toContain('<link rel="canonical" href="https://evicted.dev/" data-head>');
    expect(html).toContain('<script type="application/ld+json" data-head>');
    expect(html).not.toMatch(/\sstyle=|\son\w+=/);
  });

  it("swaps the title and managed tags on navigation without duplicating", () => {
    applyHead(document, headModel(metaFor("/")));
    applyHead(document, headModel(metaFor("/link")));
    expect(document.title).toBe("Link your TV | Testcard");
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.head.querySelector('meta[name="robots"]')).not.toBeNull();
    expect(document.head.querySelector('script[type="application/ld+json"]')).toBeNull();
    applyHead(document, headModel(metaFor("/")));
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
    expect(document.head.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
  });
});
