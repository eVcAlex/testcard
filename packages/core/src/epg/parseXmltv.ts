import sax from "sax";
import { Gunzip } from "fflate";
import type { Programme } from "../source/types.js";
import { yieldToEventLoop } from "../db/applyInSlices.js";
import type { GuideChannelMap, XmltvChannel } from "./matchGuideChannels.js";

/** The most the parser holds the thread for before it lets the event loop run (the TV app's UI shares it). */
const SLICE_MS = 30;
/** Text handed to the XML parser at once: a slice's worth on a Fire TV stick. */
const PIECE_CHARS = 32 * 1024;
/** Compressed bytes inflated at once: about as much text again as a piece, for a typical guide. */
const INFLATE_BYTES = 4 * 1024;

/**
 * Streaming XMLTV parser: gunzip + SAX, so a multi-tens-of-MB EPG file is never buffered
 * whole or turned into a DOM. Yields Programmes as `<programme>` elements close, a chunk's worth at a time.
 *
 * `channels` says which of our channels a `<programme channel="...">` is for. Either a lookup from the XMLTV channel
 * id (the provider's `tvg-id`) to our Channel id, or a function given the guide's own channel list (its `<channel>`
 * elements, which XMLTV puts before the listings) that returns the guide id to channel ids map, so a guide can be
 * matched by channel name as well as id (see `matchGuideChannels`). A programme is yielded once for every channel
 * it is for.
 *
 * Plain JavaScript all the way down (sax's callback parser, fflate's gunzip), so it runs on the TV apps too,
 * where there is neither Node's `stream` nor `DecompressionStream`. A gzipped body is recognised by its first
 * bytes: a `.gz` URL whose server already undid the compression arrives plain. `gzipped` is kept for callers
 * that pass it and changes nothing.
 */
export async function* parseXmltv(
  body: ReadableStream<Uint8Array>,
  channels: ReadonlyMap<string, string> | ((guide: readonly XmltvChannel[]) => GuideChannelMap),
  _options: { readonly gzipped?: boolean } = {},
): AsyncGenerator<Programme> {
  const parser = sax.parser(true, { trim: true, lowercase: true });
  const ready: Programme[] = [];
  let parseError: Error | null = null;

  // Decided once the guide's channel list has been read: at its first listing, or at its end.
  let lookup: GuideChannelMap | undefined =
    typeof channels === "function" ? undefined : new Map([...channels].map(([guideId, channelId]) => [guideId, [channelId]]));
  const guideChannels: XmltvChannel[] = [];
  const resolve = (): GuideChannelMap => (lookup ??= typeof channels === "function" ? channels(guideChannels) : new Map());

  let inGuideChannel: { id: string; names: string[] } | null = null;
  let displayName: string | null = null;
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
      resolve();
      currentChannel = String(node.attributes["channel"] ?? "");
      currentStart = parseXmltvDate(String(node.attributes["start"] ?? ""));
      currentStop = parseXmltvDate(String(node.attributes["stop"] ?? ""));
      currentTitle = "";
      currentDescription = "";
    } else if (name === "title") {
      inTitle = true;
    } else if (name === "desc") {
      inDesc = true;
    } else if (name === "channel" && lookup === undefined) {
      inGuideChannel = { id: String(node.attributes["id"] ?? ""), names: [] };
    } else if (name === "display-name" && inGuideChannel !== null) {
      displayName = "";
    }
  };
  parser.ontext = (text) => {
    if (inTitle) currentTitle += text;
    if (inDesc) currentDescription += text;
    if (displayName !== null) displayName += text;
  };
  parser.oncdata = parser.ontext;
  parser.onclosetag = (name) => {
    if (name === "title") inTitle = false;
    else if (name === "desc") inDesc = false;
    else if (name === "display-name") {
      if (inGuideChannel !== null && displayName !== null && displayName !== "") inGuideChannel.names.push(displayName);
      displayName = null;
    } else if (name === "channel" && inGuideChannel !== null) {
      if (inGuideChannel.id !== "") guideChannels.push({ id: inGuideChannel.id, displayNames: inGuideChannel.names });
      inGuideChannel = null;
    } else if (name === "programme") {
      const channelIds = currentChannel !== null ? lookup?.get(currentChannel) : undefined;
      if (channelIds !== undefined && currentStart !== null && currentStop !== null && currentTitle !== "") {
        for (const channelId of channelIds) {
          ready.push({
            channelId,
            title: currentTitle,
            start: currentStart,
            end: currentStop,
            ...(currentDescription !== "" ? { description: currentDescription } : {}),
          });
        }
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
  // Text waiting for the parser. A compressed chunk can inflate to a megabyte or more, far too much to parse in one
  // go on a TV (the remote stalls): it is parsed a piece at a time, with the event loop let run between slices.
  const waiting: string[] = [];
  const decode = (bytes: Uint8Array, last = false) => {
    const text = decoder.decode(bytes, { stream: !last });
    if (text !== "") waiting.push(text);
  };
  // Undecided until the first bytes arrive: gzip's magic number says whether to inflate.
  let gunzip: Gunzip | null | undefined;

  const reader = body.getReader();
  let sliceStarted = Date.now();
  async function* drain(): AsyncGenerator<Programme> {
    while (waiting.length > 0) {
      const text = waiting.shift()!;
      for (let at = 0; at < text.length; at += PIECE_CHARS) {
        parser.write(text.slice(at, at + PIECE_CHARS));
        while (ready.length > 0) {
          yielded += 1;
          yield ready.shift()!;
        }
        // Chunks already downloaded resolve at once, so without this a large guide would parse start to finish
        // without the UI getting a frame in.
        if (Date.now() - sliceStarted > SLICE_MS) {
          await yieldToEventLoop();
          sliceStarted = Date.now();
        }
      }
    }
  }
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value === undefined || value.length === 0) continue;
      gunzip ??= value[0] === 0x1f && value[1] === 0x8b ? new Gunzip((chunk) => decode(chunk)) : null;
      if (gunzip === null) {
        decode(value);
        yield* drain();
        continue;
      }
      // Inflated a little at a time too: a guide compresses twenty to one, so one downloaded chunk is a lot of text.
      for (let at = 0; at < value.length; at += INFLATE_BYTES) {
        gunzip.push(value.subarray(at, at + INFLATE_BYTES));
        yield* drain();
      }
    }
    if (gunzip) gunzip.push(new Uint8Array(0), true);
    decode(new Uint8Array(0), true);
    yield* drain();
    parser.close();
    resolve();
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
