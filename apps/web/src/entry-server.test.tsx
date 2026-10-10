import { render } from "./entry-server.tsx";
import { ROUTES } from "./routes-meta.ts";

describe("prerender render()", () => {
  it.each(ROUTES.map((r) => r.path))("renders %s with one H1, the layout and a 200", async (path) => {
    const out = await render(path);
    expect(out.status).toBe(200);
    expect(out.html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(out.html).toMatch(/<a [^>]*class="skip"[^>]*>Skip to content<\/a>/);
    expect(out.html).toContain("Ships no channels.");
    expect(out.head).toContain(`<title>`);
  });

  it("renders unknown paths as the No signal page with a 404 and noindex", async () => {
    const out = await render("/nope");
    expect(out.status).toBe(404);
    expect(out.html).toContain("No signal");
    expect(out.html).toContain('class="lost-sq"');
    expect(out.head).toContain("noindex");
  });

  it("emits nothing the CSP would block: no inline style attributes, no inline handlers, no inline scripts", async () => {
    for (const path of [...ROUTES.map((r) => r.path), "/nope"]) {
      const { html, head } = await render(path);
      expect(html).not.toMatch(/\sstyle=|\son[a-z]+=|<script|javascript:/i);
      const scripts = head.match(/<script[^>]*>/g) ?? [];
      for (const s of scripts) expect(s).toContain("application/ld+json");
    }
  });

  it("puts JSON-LD on the home page head", async () => {
    expect((await render("/")).head).toContain('"@type":"SoftwareApplication"');
  });

  it("puts FAQPage JSON-LD on the /faq head", async () => {
    const { head } = await render("/faq");
    expect(head).toContain('"@type":"FAQPage"');
    const ld = /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s.exec(head)?.[1] ?? "";
    expect(ld).toContain("FAQPage");
    expect(ld).not.toMatch(/legal|Is Testcard free/i);
  });

  it("renders the lazy routes (Download, Link) into the prerendered HTML", async () => {
    expect((await render("/download")).html).toContain("Join the Testcard beta");
    expect((await render("/link")).html).toContain("Link your TV");
  });
});
