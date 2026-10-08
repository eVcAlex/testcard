import { render } from "../entry-server.tsx";

describe("Home, server-rendered", () => {
  it("has one H1 and a usable now/next list without any script", async () => {
    const { html } = await render("/");
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain("The guide is the page.");
    expect(html).toContain('id="guide"');
    expect(html).toContain('role="listbox"');
    expect(html.match(/role="option"/g)).toHaveLength(14);
    // the on-air programme at the fixed 20:58 demo clock, and what follows
    expect(html).toContain("Weather Front");
    expect(html).toContain("20:58");
    expect(html).toContain("Show all channels (14)");
    expect(html).toContain("Muted preview");
    expect(html).toContain("Demo · invented channels, no real streams");
  });

  it("renders identically twice: no clock or random numbers in the markup", async () => {
    expect((await render("/")).html).toBe((await render("/")).html);
  });
});
