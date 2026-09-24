import sax from "sax";
import { Gunzip } from "fflate";
import type { Programme } from "../source/types.js";

/**
 * Streaming XMLTV parser: gunzip + SAX, so a multi-tens-of-MB EPG file is never buffered
 * whole or turned into a DOM. Yields Programmes as `<programme>` elements close, a chunk's worth at a time.
 *
 * `channelIdMap` translates the XMLTV `channel` attribute (the provider's `tvg-id`) to our
 * internal Channel id — pass a lookup built from the already-imported channel list.
 *
 * Plain JavaScript all the way down (sax's callback parser, fflate's gunzip), so it runs on the TV apps too,
 * where there is neither Node's `stream` nor `DecompressionStream`. A gzipped body is recognised by its first
 * bytes: a `.gz` URL whose server already undid the compression arrives plain. `gzipped` is kept for callers
 * that pass it and changes nothing.
 */
export async function* parseXmltv(
  body: ReadableStream<Uint8Array>,
  channelIdMap: ReadonlyMap<string, string>,
  _options: { readonly gzipped?: boolean } = {},
): AsyncGenerator<Programme> {
  const parser = sax.parser(true, { trim: true, lowercase: true });
  const ready: Programme[] = [];
  let parseError: Error | null = null;

  let currentChannel: string | null = null;
  let currentStart: Date | null = null;
  let currentStop: Date | null = null;
  let currentTitle = "";
  let currentDescription = "";
  let inTitle = false;
  let inDesc = false;

  parser.onopentag = (node) => {
    const name = node.name;
    if (name === "programme") {
      currentChannel = String(node.attributes["channel"] ?? "");
      currentStart = parseXmltvDate(String(node.attributes["start"] ?? ""));
      currentStop = parseXmltvDate(String(node.attributes["stop"] ?? ""));
      currentTitle = "";
      currentDescription = "";
    } else if (name === "title") {
      inTitle = true;
    } else if (name === "desc") {
      inDesc = true;
    }
  };
  parser.ontext = (text) => {
    if (inTitle) currentTitle += text;
    if (inDesc) currentDescription += text;
  };
  parser.oncdata = parser.ontext;
  parser.onclosetag = (name) => {
    if (name === "title") inTitle = false;
    else if (name === "desc") inDesc = false;
    else if (name === "programme") {
      const channelId = currentChannel !== null ? channelIdMap.get(currentChannel) : undefined;
      if (channelId !== undefined && currentStart !== null && currentStop !== null && currentTitle !== "") {
        ready.push({
          channelId,
          title: currentTitle,
          start: currentStart,
          end: currentStop,
          ...(currentDescription !== "" ? { description: currentDescription } : {}),
        });
      }
      currentChannel = null;
      currentStart = null;
      currentStop = null;
    }
  };
  // Providers' guides are often not quite XML (a bare "&" in a title). Carry on past the fault; only a body that
  // gave nothing at all (an HTML error page, say) fails.
  let yielded = 0;
  parser.onerror = (error) => {
    parseError ??= error instanceof Error ? error : new Error(String(error));
    parser.resume();
  };

  const decoder = new TextDecoder("utf-8");
  const feed = (bytes: Uint8Array) => {
    parser.write(decoder.decode(bytes, { stream: true }));
  };
  // Undecided until the first bytes arrive: gzip's magic number says whether to inflate.
  let gunzip: Gunzip | null | undefined;

  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value === undefined || value.length === 0) continue;
      gunzip ??= value[0] === 0x1f && value[1] === 0x8b ? new Gunzip((chunk) => feed(chunk)) : null;
      if (gunzip !== null) gunzip.push(value);
      else feed(value);
      while (ready.length > 0) {
        yielded += 1;
        yield ready.shift()!;
      }
    }
    if (gunzip) gunzip.push(new Uint8Array(0), true);
    feed(new Uint8Array(0));
    parser.close();
    if (parseError !== null && yielded === 0 && ready.length === 0) throw parseError;
    while (ready.length > 0) yield ready.shift()!;
  } finally {
    reader.releaseLock();
  }
}

/** XMLTV dates look like "20260905183000 +0000". */
function parseXmltvDate(raw: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?$/.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, offset] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${offset ? `${offset.slice(0, 3)}:${offset.slice(3)}` : "Z"}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
