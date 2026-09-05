import sax from "sax";
import type { Programme } from "../source/types.js";

/**
 * Streaming XMLTV parser: gunzip + SAX, so a multi-tens-of-MB EPG file is never buffered
 * whole or turned into a DOM. Yields one Programme at a time as `<programme>` elements close.
 *
 * `channelIdMap` translates the XMLTV `channel` attribute (the provider's `tvg-id`) to our
 * internal Channel id — pass a lookup built from the already-imported channel list.
 */
export async function* parseXmltv(
  body: ReadableStream<Uint8Array>,
  channelIdMap: ReadonlyMap<string, string>,
  options: { readonly gzipped?: boolean } = {},
): AsyncGenerator<Programme> {
  // The cast below works around a lib.dom.d.ts generic-strictness quirk, not a real type
  // mismatch: DecompressionStream's declared WritableStream<BufferSource> vs the plain
  // ReadableStream<Uint8Array> here don't unify structurally even though every concrete
  // BufferSource passed at runtime is in fact a Uint8Array chunk. Derived via
  // `Parameters<typeof body.pipeThrough>` (rather than naming `ReadableWritablePair`
  // directly) so this compiles whether the ambient stream types in scope are Node's
  // (this package's own tsconfig, no DOM lib) or the DOM lib's (apps/desktop's renderer
  // tsconfig, which pulls this file in transitively through @testcard/core's types).
  const decompressed: ReadableStream<Uint8Array> = options.gzipped
    ? (body.pipeThrough(new DecompressionStream("gzip") as unknown as Parameters<typeof body.pipeThrough>[0]) as unknown as ReadableStream<Uint8Array>)
    : body;
  const parser = sax.createStream(true, { trim: true, lowercase: true });

  let currentChannel: string | null = null;
  let currentStart: Date | null = null;
  let currentStop: Date | null = null;
  let currentTitle = "";
  let currentDescription = "";
  let inTitle = false;
  let inDesc = false;

  // Bridge sax's event-callback API to an async generator via a small pull queue,
  // since sax doesn't natively support backpressure-aware async iteration.
  const queue: Programme[] = [];
  let resolveNext: (() => void) | null = null;
  let done = false;
  let parseError: Error | null = null;

  const wake = () => {
    resolveNext?.();
    resolveNext = null;
  };

  parser.on("opentag", (node) => {
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
  });

  parser.on("text", (text) => {
    if (inTitle) currentTitle += text;
    if (inDesc) currentDescription += text;
  });

  parser.on("closetag", (name) => {
    if (name === "title") inTitle = false;
    else if (name === "desc") inDesc = false;
    else if (name === "programme") {
      const channelId = currentChannel !== null ? channelIdMap.get(currentChannel) : undefined;
      if (channelId !== undefined && currentStart !== null && currentStop !== null && currentTitle !== "") {
        queue.push({
          channelId,
          title: currentTitle,
          start: currentStart,
          end: currentStop,
          ...(currentDescription !== "" ? { description: currentDescription } : {}),
        });
        wake();
      }
      currentChannel = null;
      currentStart = null;
      currentStop = null;
    }
  });

  parser.on("error", (error) => {
    parseError = error instanceof Error ? error : new Error(String(error));
    done = true;
    wake();
  });

  parser.on("end", () => {
    done = true;
    wake();
  });

  const reader = decompressed.getReader();
  const decoder = new TextDecoder("utf-8");

  void (async () => {
    try {
      for (;;) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        parser.write(decoder.decode(value, { stream: true }));
      }
      parser.end();
    } catch (error) {
      parseError = error instanceof Error ? error : new Error(String(error));
      done = true;
      wake();
    }
  })();

  while (!done || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
      continue;
    }
    const programme = queue.shift();
    if (programme) yield programme;
  }

  if (parseError) throw parseError;
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
