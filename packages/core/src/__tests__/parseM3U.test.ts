import { describe, expect, it } from "vitest";
import { parseM3U } from "../source/m3u/parseM3U.js";

async function* chunksOf(text: string, chunkSize: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += chunkSize) yield text.slice(i, i + chunkSize);
}

async function collect(text: string, chunkSize = text.length) {
  const items = [];
  for await (const item of parseM3U(chunksOf(text, chunkSize))) items.push(item);
  return items;
}

const SAMPLE = [
  '#EXTM3U url-tvg="https://example.com/epg.xml.gz"',
  '#EXTINF:-1 tvg-id="tnt1" tvg-logo="https://example.com/tnt1.png" group-title="UK| TNT Sports ᴳᴬᴺᴶᴬ" catchup-type="flussonic" catchup-days="3",TNT Sports 1 (1080p50)',
  "http://host/user/pass/token/1.ts",
  '#EXTINF:-1 group-title="CA| SPORTS PPV",Rolex SailGP Championship',
  "http://host/user/pass/token/2.ts",
].join("\n");

describe("parseM3U", () => {
  it("emits a header with the url-tvg attribute", async () => {
    const [first] = await collect(SAMPLE);
    expect(first).toMatchObject({ kind: "header", header: { urlTvg: "https://example.com/epg.xml.gz" } });
  });

  it("pairs each #EXTINF with the following URL line", async () => {
    const items = await collect(SAMPLE);
    const entries = items.filter((i) => i.kind === "entry");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      entry: { rawName: "TNT Sports 1 (1080p50)", url: "http://host/user/pass/token/1.ts", groupTitle: "UK| TNT Sports ᴳᴬᴺᴶᴬ" },
    });
  });

  it("keeps the tvg-id attribute for the EPG join", async () => {
    const items = await collect(SAMPLE);
    const first = items.find((i) => i.kind === "entry");
    expect(first?.kind === "entry" && first.entry.attributes["tvg-id"]).toBe("tnt1");
  });

  it("parses catchup attributes", async () => {
    const items = await collect(SAMPLE);
    const first = items.find((i) => i.kind === "entry");
    expect(first?.kind === "entry" && first.entry.attributes["catchup-days"]).toBe("3");
  });

  it("produces identical results regardless of how the input is chunked", async () => {
    const whole = await collect(SAMPLE, SAMPLE.length);
    const byteAtATime = await collect(SAMPLE, 1);
    expect(byteAtATime).toEqual(whole);
  });

  it("handles CRLF line endings", async () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    const items = await collect(crlf);
    const entries = items.filter((i) => i.kind === "entry");
    expect(entries).toHaveLength(2);
  });

  it("ignores unrecognised directives like #EXT-X-CREDENTIALS", async () => {
    const withCredentials = `${SAMPLE}\n#EXT-X-CREDENTIALS:user=foo&password=bar`;
    const items = await collect(withCredentials);
    expect(items.filter((i) => i.kind === "entry")).toHaveLength(2);
  });
});
