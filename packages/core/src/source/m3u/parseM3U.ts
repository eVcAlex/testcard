/**
 * Streaming EXTM3U parser. Consumes an async-iterable of text chunks (a fetch response body,
 * a file stream, whatever) and yields one entry at a time via an async generator, so a
 * multi-thousand-channel playlist (the reference provider ships 18k+ entries in ~6MB) is
 * never held fully in memory as either raw text or parsed objects.
 */

export interface M3UEntry {
  readonly rawName: string;
  readonly url: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly groupTitle?: string;
}

export interface M3UHeader {
  readonly urlTvg?: string;
}

const ATTRIBUTE = /([a-zA-Z0-9-]+)="([^"]*)"/g;

/**
 * Async line reader over any async-iterable of string/Uint8Array chunks. Handles chunk
 * boundaries splitting a line in two, and both \n and \r\n line endings.
 */
async function* toLines(source: AsyncIterable<string | Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of source) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      yield buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.length > 0) yield buffer.replace(/\r$/, "");
}

function parseAttributes(extinfLine: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTRIBUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE.exec(extinfLine)) !== null) {
    const [, key, value] = match;
    if (key !== undefined && value !== undefined) attrs[key] = value;
  }
  return attrs;
}

function parseDisplayName(extinfLine: string): string {
  const commaIndex = extinfLine.lastIndexOf(",");
  return commaIndex === -1 ? "" : extinfLine.slice(commaIndex + 1).trim();
}

/**
 * Parses an M3U playlist, yielding a header (once) then each entry as it's found.
 * Callers should insert entries into SQLite in batches as they arrive rather than
 * collecting them into an array first — see `packages/core/src/db` import routine.
 */
export async function* parseM3U(
  source: AsyncIterable<string | Uint8Array>,
): AsyncGenerator<{ kind: "header"; header: M3UHeader } | { kind: "entry"; entry: M3UEntry }> {
  let pendingExtinf: string | null = null;
  let headerEmitted = false;

  for await (const line of toLines(source)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.startsWith("#EXTM3U")) {
      if (!headerEmitted) {
        const urlTvgMatch = /url-tvg="([^"]*)"/.exec(trimmed);
        yield {
          kind: "header",
          header: urlTvgMatch?.[1] !== undefined ? { urlTvg: urlTvgMatch[1] } : {},
        };
        headerEmitted = true;
      }
      continue;
    }

    if (trimmed.startsWith("#EXTINF")) {
      pendingExtinf = trimmed;
      continue;
    }

    if (trimmed.startsWith("#")) {
      // Other directives (#EXT-X-CREDENTIALS, #EXTGRP, ...) — not needed for v1, skipped.
      continue;
    }

    // A non-comment, non-empty line following an #EXTINF is the stream URL.
    if (pendingExtinf !== null) {
      const attributes = parseAttributes(pendingExtinf);
      yield {
        kind: "entry",
        entry: {
          rawName: parseDisplayName(pendingExtinf),
          url: trimmed,
          attributes,
          ...(attributes["group-title"] !== undefined ? { groupTitle: attributes["group-title"] } : {}),
        },
      };
      pendingExtinf = null;
    }
  }
}
