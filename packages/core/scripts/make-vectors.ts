/**
 * Input -> output vectors produced by the real TypeScript functions. The native Android app's tests read these files
 * and must reproduce every output, so "same ids, same keys, same wire bytes" is proven rather than hoped for.
 *
 * `src/__tests__/vectors.test.ts` rebuilds them in memory and compares with the committed files; after an intended
 * change to a covered function, `pnpm --filter @testcard/core vectors` rewrites the files.
 */
import golden from "../src/__tests__/fixtures/categoryGolden.json" with { type: "json" };
import { classifyCategory } from "../src/normalise/classifyCategory.js";
import { channelDisplayName, displayName, fallbackRank, sameChannelKey } from "../src/normalise/displayName.js";
import { groupVariants, type RawChannelEntry } from "../src/normalise/groupVariants.js";
import { dropVariantMarks, parseName } from "../src/normalise/parseName.js";
import { splitTitle } from "../src/normalise/splitTitle.js";
import { isDatedTitle, titleKey } from "../src/normalise/titleKey.js";
import { classifyEntry, movieKey, seriesKey, urlExtension } from "../src/source/m3u/classifyEntry.js";
import { parseM3U } from "../src/source/m3u/parseM3U.js";
import { extractXtreamCredentials } from "../src/source/xtream/detect.js";
import { programmeMinutes, timeshiftStamp } from "../src/source/xtream/catchup.js";
import { parseXmltv } from "../src/epg/parseXmltv.js";
import { isWatched, shouldPromptResume } from "../src/playback/progressPolicy.js";
import { normalizeProviderHost, remoteKeyFor, remoteKeyForPlaylist, remoteKeyForPlaylistItem } from "../src/sync/remoteKey.js";
import { channelKeyFor } from "../src/sync/channelHistory.js";
import { pinHash } from "../src/db/profileIdentity.js";
import { decryptJson, encryptJson } from "../src/sync/credentialCrypto.js";
import {
  LINK_ALPHABET,
  LINK_CODE_LENGTH,
  LINK_ITERATIONS,
  LINK_LOOKUP_SALT,
  deriveLinkLookup,
  formatLinkCode,
  generateLinkCode,
  isValidLinkCode,
  normaliseLinkCode,
  openLinkSecrets,
  sealLinkSecrets,
} from "../src/sync/linkCrypto.js";

export interface Vector {
  readonly fn: string;
  readonly in: readonly unknown[];
  readonly out: unknown;
}

const AWKWARD = [
  "",
  " ",
  " UK| Sky Sports ",
  "﻿UK| BOM Channel",
  "　UK| Ideographic Space　",
  "UK| Sky Sports Main Event ᵁᴴᴰ ᴴᴰᴿ",
  "UK| TNT Sports ᴳᴬᴺᴶᴬ",
  "🔥 Fire Channel 🔥",
  "İstanbul TV",
  "STRASSE ß HD",
  "##### PPV #####",
  "##### PPV HD/4K #####",
  "TNT Sports Ultimate (OFFLINE)",
  "TNT Sports 1 (1080p50)",
  "TNT Sports 1 (720p25)",
  "Channel (4K)",
  "Channel (UHD)",
  "Channel (FHD) (OFFLINE)",
  "UK| BBC One HD",
  "[UK] BBC Two",
  "|UK| ITV 1",
  "US| ESPN 2 (SD)",
  "FR | TF1",
  "The Wire S01E02",
  "The.Wire.S01E02E03.1080p",
  "Show 1x02",
  "A".repeat(500),
  "x".repeat(500) + " (1080p50)",
  "Plain name",
  "  spaced   out   name  ",
  "Movie Title (2019)",
  "Movie Title (2019) 4K",
  "UK: Movie Title - 2019",
  "Le Film: Épisode 1",
];

const CATEGORY_NAMES = [...golden.map((row) => row.name), ...AWKWARD, "|EN| DRAMA/ROMANCE", "EN - SCIENCE FICTION", "US| MILB PPV", "XXX ADULT", "VIP | PREMIUM", "RAW 4K", "-----"];

const M3U_SAMPLES = [
  [
    '#EXTM3U url-tvg="https://example.com/epg.xml.gz"',
    '#EXTINF:-1 tvg-id="tnt1" tvg-logo="https://example.com/tnt1.png" group-title="UK| TNT Sports ᴳᴬᴺᴶᴬ" catchup-type="flussonic" catchup-days="3",TNT Sports 1 (1080p50)',
    "http://host/user/pass/token/1.ts",
    '#EXTINF:-1 group-title="CA| SPORTS PPV",Rolex SailGP Championship',
    "http://host/user/pass/token/2.ts",
  ].join("\n"),
  // CRLF, blank lines, comments, an #EXTM3U twice, a BOM, no header, a missing URL, commas in the name.
  "﻿#EXTM3U\r\n\r\n#EXTINF:-1 tvg-id=\"a\" group-title=\"News\",Name, with comma\r\nhttp://h/1.ts\r\n#EXTVLCOPT:foo=bar\r\n#EXTINF:-1,Second\r\nhttp://h/2.m3u8\r\n#EXTM3U\r\n#EXTINF:-1,Orphan with no url\r\n",
  '#EXTINF:-1 tvg-name="Only" group-title="G",Only\nhttp://h/only.ts\n',
  '#EXTM3U\n#EXTINF:-1 group-title="Movies",Some Movie (2020)\nhttp://h/movie/u/p/1.mp4\n#EXTINF:-1 group-title="Series",Show S01E02 Title\nhttp://h/series/u/p/2.mkv\n',
];

const CLASSIFY_ENTRIES: [string, string][] = [
  ["TNT Sports 1", "http://h/live/u/p/1.ts"],
  ["Some Movie (2020)", "http://h/movie/u/p/1.mp4"],
  ["Some Movie (2020)", "http://h/movies/u/p/1.mkv?token=abc#frag"],
  ["Show S01E02 Title", "http://h/series/u/p/2.mkv"],
  ["Show S1 E2", "http://h/x/2.avi"],
  ["The.Wire.S01E02E03.720p", "http://h/x/2.mp4"],
  ["Show 1x02 Pilot", "http://h/x/2.mp4"],
  ["Show 12x105", "http://h/x/2.mp4"],
  ["Just a film", "http://h/vod/u/p/9.m4v"],
  ["Live thing", "http://h/u/p/9.ts"],
  ["Live thing", "http://h/u/p/9.m3u8"],
  ["Not a url", "not a url"],
  ["Mixed CASE", "HTTP://H/MOVIE/U/P/1.MP4"],
  ["", ""],
];

const XTREAM_URLS = [
  "http://host:8080/get.php?username=U&password=P&type=m3u_plus",
  "http://host/get.php?username=U&password=",
  "http://host/U/P/1234.ts",
  "http://host/U/P/token/1234.ts",
  "https://host:443/live/U/P/1.ts",
  "http://host/",
  "http://host/only",
  "not a url",
  "",
  "http://host/get.php?username=us%20er&password=p%26w",
  "HTTP://HOST:80/a/b/c",
];

const HOSTS = ["host", "HOST.com", "http://Host.com:80/", "https://host.com:443", "host.com:8080", "http://host.com:8080/path", "  host  ".trim(), "host.com/", "192.168.0.1:8000", "[::1]:80"];

const PLAYLISTS = ["http://h/get.php?username=u&password=p", "  http://h/list.m3u  ", "http://h/list.m3u?x=1&y=2", ""];

const FIXED_BYTES = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff);

/** `crypto.getRandomValues` returns the same bytes every call, so sealed blobs are reproducible. */
async function withFixedRandom<T>(run: () => Promise<T>): Promise<T> {
  const original = crypto.getRandomValues.bind(crypto);
  Object.defineProperty(crypto, "getRandomValues", {
    configurable: true,
    value: (array: Uint8Array) => {
      array.set(FIXED_BYTES.subarray(0, array.length));
      return array;
    },
  });
  try {
    return await run();
  } finally {
    Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: original });
  }
}

function chunks(text: string, size: number): AsyncIterable<string> {
  return (async function* () {
    for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
  })();
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function rawEntry(sourceId: string, categoryId: string, id: string, rawName: string, extra: Partial<RawChannelEntry> = {}): RawChannelEntry {
  return { sourceId, categoryId, providerStreamId: id, rawName, ...extra };
}

const XMLTV = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="tnt1"><display-name>TNT 1</display-name></channel>
  <programme channel="tnt1" start="20990101120000 +0000" stop="20990101130000 +0000">
    <title>The Match</title>
    <desc>Live coverage &amp; analysis.</desc>
  </programme>
  <programme channel="tnt1" start="20990101130000 +0100" stop="20990101140000 +0100"><title lang="en">Post-Match</title></programme>
  <programme channel="tnt1" start="20990101140000" stop="20990101150000"><title>No offset</title><desc/></programme>
  <programme channel="tnt1" start="bad" stop="20990101150000"><title>Bad start</title></programme>
  <programme channel="tnt1" start="20990101150000 +0000" stop="20990101160000 +0000"></programme>
  <programme channel="not-mapped" start="20990101120000 +0000" stop="20990101130000 +0000"><title>Ignored</title></programme>
  <programme channel="TNT1" start="20990101160000 +0000" stop="20990101170000 +0000"><title>Case</title></programme>
</tv>`;

export async function buildVectors(): Promise<Record<string, Vector[]>> {
  const out: Record<string, Vector[]> = {};
  const add = (file: string, fn: string, args: readonly unknown[], result: unknown) => {
    (out[file] ??= []).push({ fn, in: args, out: result === undefined ? null : result });
  };

  const names = [...new Set([...CATEGORY_NAMES, ...AWKWARD])];

  for (const name of names) {
    add("normalise", "parseName", [name], parseName(name));
    add("normalise", "dropVariantMarks", [name], dropVariantMarks(name));
    add("normalise", "displayName", [name], displayName(name));
    add("normalise", "channelDisplayName", [name], channelDisplayName(name));
    add("normalise", "sameChannelKey", [name], sameChannelKey(name));
    add("normalise", "fallbackRank", [name], fallbackRank(name));
    add("normalise", "splitTitle", [name], splitTitle(name));
    add("normalise", "titleKey", [name], titleKey(name));
    add("normalise", "isDatedTitle", [name], isDatedTitle(name));
    add("normalise", "classifyCategory", [name], classifyCategory(name));
  }

  const entries = [
    rawEntry("s1", "c1", "1", "UK| TNT Sports 1 (1080p50)", { tvgId: "tnt1", channelNumber: 1, logoUrl: "http://l/1.png" }),
    rawEntry("s1", "c1", "2", "UK| TNT Sports 1 (720p25)"),
    rawEntry("s1", "c1", "3", "UK| TNT Sports 1 (OFFLINE)", { catchup: { type: "flussonic", days: 3 } }),
    rawEntry("s1", "c2", "4", "UK| TNT Sports 1 (1080p50)"),
    rawEntry("s1", "c1", "5", "US| TNT Sports 1 (4K)"),
    rawEntry("s1", "c1", "6", "##### PPV #####"),
    rawEntry("s2", "c1", "7", "UK| TNT Sports 1 (1080p50)", { tvgId: "later" }),
  ];
  add("normalise", "groupVariants", [entries], groupVariants(entries));

  for (const text of M3U_SAMPLES) {
    for (const size of [text.length, 7, 1]) {
      const items = [];
      for await (const item of parseM3U(chunks(text, size))) items.push(item);
      add("m3u", "parseM3U", [text, size], items);
    }
  }
  for (const [rawName, url] of CLASSIFY_ENTRIES) {
    add("m3u", "classifyEntry", [{ rawName, url }], classifyEntry({ rawName, url }));
    add("m3u", "urlExtension", [url], urlExtension(url));
  }
  for (const name of ["The Wire", "The.Wire", "UK| The Wire (2002)", "A  B", ""]) {
    add("m3u", "seriesKey", [name], seriesKey(name));
    add("m3u", "movieKey", [name], movieKey(name));
  }

  for (const url of XTREAM_URLS) add("xtream", "extractXtreamCredentials", [url], extractXtreamCredentials(url));
  for (const stamp of ["2024-05-06 07:08:09", "2024-05-06T07:08:09", "2024-05-06 07:08", "05/06/2024", "", "2024-5-6 7:8:9"]) {
    add("catchup", "timeshiftStamp", [stamp], timeshiftStamp(stamp));
  }
  for (const [start, end] of [
    ["2024-01-01T10:00:00Z", "2024-01-01T11:00:00Z"],
    ["2024-01-01T10:00:00Z", "2024-01-01T10:00:20Z"],
    ["2024-01-01T10:00:00Z", "2024-01-01T10:00:40Z"],
    ["2024-01-01T10:00:00Z", "2024-01-01T10:00:00Z"],
    ["2024-01-01T10:00:00Z", "2024-01-01T09:00:00Z"],
  ] as const) {
    add("catchup", "programmeMinutes", [start, end], programmeMinutes({ start: new Date(start), end: new Date(end) }));
  }

  const map = new Map([["tnt1", "channel-1"]]);
  for (const text of [XMLTV, ""]) {
    const programmes = [];
    for await (const programme of parseXmltv(streamOf(text), map)) programmes.push(programme);
    add("xmltv", "parseXmltv", [text, { tnt1: "channel-1" }], programmes);
  }

  for (const [position, duration] of [
    [0, 100],
    [29, 100],
    [30, 100],
    [94, 100],
    [95, 100],
    [100, 100],
    [10, 0],
    [10, null],
    [10, undefined],
    [30, 600],
    [570, 600],
  ] as const) {
    add("policy", "isWatched", [position, duration ?? null], isWatched(position, duration));
    add("policy", "shouldPromptResume", [position, duration ?? null], shouldPromptResume(position, duration));
  }

  for (const host of HOSTS) {
    add("keys", "normalizeProviderHost", [host], normalizeProviderHost(host));
    add("keys", "remoteKeyFor", [host, "12345"], await remoteKeyFor(host, "12345"));
  }
  add("keys", "remoteKeyFor", ["host", ""], await remoteKeyFor("host", ""));
  add("keys", "remoteKeyFor", ["host", "ünï|cöde"], await remoteKeyFor("host", "ünï|cöde"));
  for (const url of PLAYLISTS) add("keys", "remoteKeyForPlaylist", [url], await remoteKeyForPlaylist(url));
  for (const itemKey of ["the wire", "ünï", ""]) {
    add("keys", "remoteKeyForPlaylistItem", ["  http://h/list.m3u ", itemKey], await remoteKeyForPlaylistItem("  http://h/list.m3u ", itemKey));
  }
  const src = "6002e48c-0000-4000-8000-000000000001";
  for (const channelId of [
    `${src}:channel:${src}\u0001${src}:cat\u0001Sky Sports\u0001UK`,
    `${src}:channel:${src}\0${src}:cat\0Sky Sports\0UK`,
    `${src}:plain`,
    `${src}:`,
    `${src}:ünï 🔥`,
    `other:channel`,
    src,
  ]) {
    add("keys", "channelKeyFor", ["a".repeat(40), src, channelId], channelKeyFor("a".repeat(40), src, channelId));
  }
  for (const [profile, digits] of [
    ["p1abc", "1234"],
    ["p1abc", "0000"],
    ["p2", "1234"],
    ["", ""],
    ["pé", "99"],
  ] as const) {
    add("keys", "pinHash", [profile, digits], pinHash(profile, digits));
  }

  const salt = btoa(String.fromCharCode(...FIXED_BYTES.subarray(0, 16)));
  const payloads = [
    { kind: "xtream", baseUrl: "http://host:8080", username: "u", password: "p" },
    { kind: "xtream", baseUrl: "http://host", username: "ünï", password: "p\"w'\\\u0000", backupHosts: ["http://b1", "http://b2"], epgUrl: null },
    { url: "http://h/list.m3u?token=abc", label: "Playlist" },
    { id: "p1abc", name: "Kids", avatar: "fox", colour: 3, pin: "0badf00d" },
    [1, 2, 3],
    "plain string",
  ];
  await withFixedRandom(async () => {
    for (const payload of payloads) {
      const sealed = await encryptJson(payload, "correct horse", salt);
      add("crypto", "encryptJson", [payload, "correct horse", salt], sealed);
      add("crypto", "decryptJson", [sealed, "correct horse", salt], await decryptJson(sealed, "correct horse", salt));
    }
    const unicode = await encryptJson({ a: 1 }, "pässwörd 🔑", salt);
    add("crypto", "encryptJson", [{ a: 1 }, "pässwörd 🔑", salt], unicode);

    for (const code of ["ABCD2345", "K7M4QX2P"]) {
      const sealed = await sealLinkSecrets({ email: "a@b.c", password: "pw ü" }, code, salt);
      add("link", "sealLinkSecrets", [{ email: "a@b.c", password: "pw ü" }, code, salt], sealed);
      add("link", "openLinkSecrets", [sealed, code, salt], await openLinkSecrets(sealed, code, salt));
      add("link", "deriveLinkLookup", [code], await deriveLinkLookup(code));
    }
    add("link", "generateLinkCode", [], generateLinkCode());
  });
  add("link", "constants", [], { LINK_ALPHABET, LINK_CODE_LENGTH, LINK_ITERATIONS, LINK_LOOKUP_SALT });
  for (const typed of ["k7m4-qx2p", " K7M4 QX2P ", "k7m4_qx2p!", "", "ABCDEFGH"]) {
    const code = normaliseLinkCode(typed);
    add("link", "normaliseLinkCode", [typed], code);
    add("link", "isValidLinkCode", [code], isValidLinkCode(code));
    add("link", "formatLinkCode", [code], formatLinkCode(code));
  }
  for (const code of ["ABCDEFGH", "ABCDEFG", "ABCDEFG0", "ABCDEFGHI", "abcdefgh"]) add("link", "isValidLinkCode", [code], isValidLinkCode(code));

  return out;
}
