import { describe, expect, it } from "vitest";
import { parseXmltv } from "../epg/parseXmltv.js";
import type { Programme } from "../source/types.js";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <programme channel="tnt1" start="20990101120000 +0000" stop="20990101130000 +0000">
    <title>The Match</title>
    <desc>Live coverage.</desc>
  </programme>
  <programme channel="tnt1" start="20990101130000 +0000" stop="20990101140000 +0000">
    <title>Post-Match</title>
  </programme>
  <programme channel="not-mapped" start="20990101120000 +0000" stop="20990101130000 +0000">
    <title>Ignored</title>
  </programme>
</tv>`;

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>, gzipped = false): Promise<Programme[]> {
  const map = new Map([["tnt1", "channel-1"]]);
  const out: Programme[] = [];
  for await (const programme of parseXmltv(body, map, gzipped ? { gzipped: true } : {})) out.push(programme);
  return out;
}

describe("parseXmltv", () => {
  it("yields one Programme per <programme> whose channel is in the map", async () => {
    const programmes = await collect(streamOf(XML));
    expect(programmes).toHaveLength(2);
    expect(programmes[0]).toMatchObject({
      channelId: "channel-1",
      title: "The Match",
      description: "Live coverage.",
    });
    expect(programmes[1]).toMatchObject({ channelId: "channel-1", title: "Post-Match" });
    expect(programmes[1]?.description).toBeUndefined();
  });

  it("parses the XMLTV date format with a timezone offset", async () => {
    const [first] = await collect(streamOf(XML));
    expect(first?.start.toISOString()).toBe("2099-01-01T12:00:00.000Z");
    expect(first?.end.toISOString()).toBe("2099-01-01T13:00:00.000Z");
  });

  it("transparently gunzips a gzipped document", async () => {
    const gz = streamOf(XML).pipeThrough(new CompressionStream("gzip")) as ReadableStream<Uint8Array>;
    const programmes = await collect(gz, true);
    expect(programmes.map((p) => p.title)).toEqual(["The Match", "Post-Match"]);
  });
});
