/**
 * Database vectors for the native app: a provider world (Xtream replies, a playlist, a guide), the database the TypeScript
 * importers build from it, a scripted run of user actions, and what every query returns afterwards. The Kotlin port must
 * build the same database from the same provider world and return the same rows in the same order.
 *
 * Run under vitest (it fakes the clock and `fetch`); better-sqlite3 needs Electron as Node here, see the repo notes.
 * Files (under test-vectors/db/):
 *   provider.json  the provider world
 *   imported.json  every table after importing it
 *   actions.json   the user actions applied next, and every table after them
 *   queries.json   [{ fn, in, out }] over the final database
 */
import Database from "better-sqlite3";
import { vi } from "vitest";
import { migrateDatabase, runDeferredCatalogueMaintenance } from "../src/db/migrateDatabase.js";
import { importCatalogue, type CatalogueSource } from "../src/db/importCatalogue.js";
import { createXtreamAdapter } from "../src/source/xtream/client.js";
import { createM3UAdapter } from "../src/source/m3u/adapter.js";
import { importEpg } from "../src/epg/importEpg.js";
import { ensureMovieDetails, ensureSeriesEpisodes } from "../src/db/importVodDetails.js";
import * as live from "../src/db/queries.js";
import * as vod from "../src/db/vodQueries.js";
import * as series from "../src/db/seriesQueries.js";
import { movieHome, seriesHome, listWatchedLately } from "../src/db/homeQueries.js";
import { searchAll } from "../src/db/searchQueries.js";
import { listChannelFeeds } from "../src/db/channelFeeds.js";
import { clearPlaybackProgress, getPlaybackProgress, setPlaybackProgress, setWatched } from "../src/db/progressQueries.js";
import { hideCategory, hideChannel, listHidden, unhide } from "../src/sync/hidden.js";
import { listHomePins, pinCategory, pinnedCategoryIds, unpinCategory } from "../src/sync/sourcePins.js";
import { moveSource, orderedSourceIds } from "../src/sync/sourceOrder.js";
import { listProfiles, saveProfile } from "../src/db/profiles.js";
import { swapProfile } from "../src/db/profileSwap.js";
import { PROFILE_META_KEYS } from "../src/db/profileIdentity.js";

export const FIXED_NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

const XTREAM = { id: "x1", baseUrl: "http://panel.example:8080", username: "u", password: "p" };
const PLAYLIST = { id: "m1", url: "http://lists.example/main.m3u" };

// ---------------------------------------------------------------------------------------------
// the provider world

type Json = unknown;

function liveWorld(): { categories: Json; streams: Record<string, Json[]> } {
  const categories = [
    { category_id: "1", category_name: "UK| SPORTS" },
    { category_id: "2", category_name: "US| NEWS ᴴᴰ" },
    { category_id: "3", category_name: "|EN| MOVIES 4K" },
    { category_id: "4", category_name: "XXX ADULT" },
    { category_id: "5", category_name: "##### PPV #####" },
    { category_id: "6", category_name: "FR| KIDS (HD)" },
  ];
  const lists: Record<string, string[]> = {
    "1": ["UK| TNT Sports 1 (1080p50)", "UK| TNT Sports 1 (720p25)", "UK| TNT Sports 1 (OFFLINE)", "UK| TNT Sports 2 (1080p50)", "UK| Sky Sports Main Event HD", "UK| Sky Sports Premier League ᵁᴴᴰ", "UK| BT Sport 1 (4K)", "UK| BT Sport 1 (HD)", "UK| Eurosport 1", "UK| Premier Sports 1 FHD", "UK| ITV 4 (SD)"],
    "2": ["US| CNN", "US| FOX NEWS (HD)", "US| MSNBC", "US| Bloomberg (720p25)", "US| Bloomberg (1080p50)", "US| Newsmax", "UK| TNT Sports 1 (720p25)"],
    "3": ["|EN| Movie Channel A", "|EN| Movie Channel B (4K)", "|EN| Movie Channel B (HD)"],
    "4": ["XXX Channel 1", "XXX Channel 2"],
    "5": ["##### PPV 1 #####", "UFC 300 Main Card"],
    "6": ["FR| Cartoon Network", "FR| Disney Junior", "FR| TF1 (HD)", "FR| TF1"],
  };
  const streams: Record<string, Json[]> = {};
  let id = 1000;
  let num = 1;
  for (const [category, names] of Object.entries(lists)) {
    streams[category] = names.map((name) => {
      id += 1;
      const entry: Record<string, Json> = { stream_id: id, name, category_id: category, num: num++ };
      if (id % 3 !== 0) entry["stream_icon"] = `http://img.example/${id}.png`;
      if (id % 2 === 0) entry["epg_channel_id"] = `ch${id % 7}.guide`;
      if (id % 5 === 0) {
        entry["tv_archive"] = 1;
        entry["tv_archive_duration"] = 3;
      }
      return entry;
    });
  }
  return { categories, streams };
}

function vodWorld(): { categories: Json; streams: Record<string, Json[]> } {
  const categories = [
    { category_id: "1", category_name: "EN - ACTION" },
    { category_id: "2", category_name: "EN - COMEDY" },
    { category_id: "3", category_name: "4K-TOP - NEW RELEASES" },
    { category_id: "4", category_name: "FR - COMEDIE" },
    { category_id: "5", category_name: "ASIA MOVIES (MULTI-SUBS)" },
    { category_id: "6", category_name: "XXX" },
  ];
  const streams: Record<string, Json[]> = { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] };
  let id = 5000;
  const add = (category: string, name: string, rating: string | number | null, poster: boolean, ext: string | null) => {
    id += 1;
    const entry: Record<string, Json> = { stream_id: id, name, category_id: category };
    if (poster) entry["stream_icon"] = `http://img.example/m${id}.jpg`;
    if (ext !== null) entry["container_extension"] = ext;
    if (rating !== null) entry["rating"] = rating;
    streams[category]!.push(entry);
  };
  for (let i = 1; i <= 12; i += 1) add("1", `Action Film ${i} (2020)`, String(5 + i / 5), true, i % 2 === 0 ? "mp4" : "mkv");
  add("1", "No Poster", "9.5", false, "mp4");
  for (let i = 1; i <= 10; i += 1) add("2", `Comedy Film ${i}`, i % 3 === 0 ? 0 : 6 + i / 10, true, "mp4");
  add("2", "Single Vote Wonder", 10, true, "mp4");
  for (let i = 1; i <= 3; i += 1) add("3", `4K-TOP - Action Film ${i} (2020)`, "9.1", true, "mkv");
  for (let i = 1; i <= 6; i += 1) add("3", `Fresh Film ${i} (2026)`, String(6 + i / 2), true, null);
  for (let i = 1; i <= 6; i += 1) add("3", `Last Year Film ${i} (2025)`, String(9 - i / 4), true, "mp4");
  for (let i = 1; i <= 8; i += 1) add("4", `Film Francais ${i}`, "8.4", true, "mp4");
  for (let i = 1; i <= 8; i += 1) add("5", `Asian Film ${i}`, "8.5", true, "mp4");
  for (let i = 1; i <= 8; i += 1) add("6", `Adult ${i}`, "9", true, "mp4");
  return { categories, streams };
}

function seriesWorld(): { categories: Json; list: Record<string, Json[]>; info: Record<string, Json> } {
  const categories = [
    { category_id: "1", category_name: "EN - DRAMA" },
    { category_id: "2", category_name: "EN - KIDS" },
  ];
  const list: Record<string, Json[]> = { "1": [], "2": [] };
  const info: Record<string, Json> = {};
  let id = 800;
  const add = (category: string, name: string, shape: "full" | "empty" | "specials") => {
    id += 1;
    list[category]!.push({ series_id: id, name, category_id: category, cover: `http://img.example/s${id}.jpg`, plot: `Plot of ${name}`, rating: String(7 + (id % 3) / 2) });
    const episode = (season: number, n: number) => ({
      id: String(id * 100 + season * 10 + n),
      episode_num: n,
      title: `${name} S${season}E${n}`,
      container_extension: n % 2 === 0 ? "mkv" : "mp4",
      season,
      info: { duration_secs: n === 3 ? "3600" : 2700, plot: `Episode ${n}`, movie_image: `http://img.example/e${id}${season}${n}.jpg` },
    });
    if (shape === "empty") info[String(id)] = { seasons: [], episodes: [] };
    else if (shape === "specials") info[String(id)] = { seasons: [{ season_number: 1, name: "Season 1", cover: "http://img.example/c.jpg" }], episodes: { "0": [episode(0, 1)], "1": [episode(1, 1), episode(1, 2)] } };
    else info[String(id)] = { seasons: [{ season_number: 1, name: "Season 1", cover: "http://img.example/c1.jpg" }, { season_number: 2, name: "" }], episodes: { "1": [episode(1, 1), episode(1, 2), episode(1, 3)], "2": [episode(2, 1), episode(2, 2)] } };
  };
  for (let i = 1; i <= 8; i += 1) add("1", `Drama Show ${i} (2019)`, i === 3 ? "specials" : "full");
  add("2", "4K-TOP - Drama Show 1 (2019)", "full");
  for (let i = 1; i <= 7; i += 1) add("2", `Kids Show ${i}`, i === 2 ? "empty" : "full");
  return { categories, list, info };
}

const PLAYLIST_TEXT = [
  '#EXTM3U url-tvg="http://guides.example/uk.xml.gz"',
  '#EXTINF:-1 tvg-id="bbc1.uk" tvg-logo="http://img.example/bbc1.png" tvg-chno="101" group-title="UK| NEWS",UK| BBC One (1080p50)',
  "http://host.example/u/p/101.ts",
  '#EXTINF:-1 tvg-id="bbc1.uk" group-title="UK| NEWS",UK| BBC One (720p25)',
  "http://host.example/u/p/102.ts",
  '#EXTINF:-1 group-title="UK| NEWS" catchup-type="flussonic" catchup-days="3",UK| Sky News',
  "http://host.example/u/p/103.ts",
  '#EXTINF:-1 group-title="Sports",TNT Sports Ultimate (OFFLINE)',
  "http://host.example/u/p/104.ts",
  "#EXTINF:-1,No Group Channel",
  "http://host.example/u/p/105.m3u8",
  '#EXTINF:-1 tvg-logo="http://img.example/p1.jpg" group-title="Movies",Playlist Movie One (2018)',
  "http://host.example/movie/u/p/201.mp4",
  '#EXTINF:-1 group-title="Movies",Playlist Movie Two (2019)',
  "http://host.example/movie/u/p/202.mkv",
  '#EXTINF:-1 group-title="Movies",Playlist Movie One (2018)',
  "http://host.example/movie/u/p/203.mp4",
  '#EXTINF:-1 tvg-logo="http://img.example/ps.jpg" group-title="Shows",The Playlist Show S01E01 Pilot',
  "http://host.example/series/u/p/301.mkv",
  '#EXTINF:-1 group-title="Shows",The Playlist Show S01E02 Second',
  "http://host.example/series/u/p/302.mkv",
  '#EXTINF:-1 group-title="Shows",The Playlist Show S02E01',
  "http://host.example/series/u/p/303.mkv",
  '#EXTINF:-1 group-title="Shows",Another Show 1x05',
  "http://host.example/series/u/p/304.mp4",
].join("\n");

const pad = (n: number) => String(n).padStart(2, "0");
const xmltvDate = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`;
};

function guideText(): string {
  const rows: string[] = [`<?xml version="1.0" encoding="UTF-8"?>`, "<tv>"];
  const hour = 3_600_000;
  for (let c = 0; c < 7; c += 1) {
    rows.push(`<channel id="ch${c}.guide"><display-name>Channel ${c}</display-name></channel>`);
    // From 8 hours ago (older than the import keeps) to a day ahead, in two-hour blocks, a few with an "&" in the title.
    for (let block = -4; block < 12; block += 1) {
      const start = FIXED_NOW + block * 2 * hour + c * 600_000;
      const title = block % 5 === 0 ? `News &amp; Weather ${block}` : `Show ${c}-${block}`;
      rows.push(`<programme start="${xmltvDate(start)}" stop="${xmltvDate(start + 2 * hour)}" channel="ch${c}.guide"><title lang="en">${title}</title>${block % 3 === 0 ? `<desc>About ${title}</desc>` : ""}</programme>`);
    }
  }
  rows.push(`<programme start="${xmltvDate(FIXED_NOW)}" stop="${xmltvDate(FIXED_NOW + 3_600_000)}" channel="unknown.guide"><title>Unwanted</title></programme>`);
  rows.push("</tv>");
  return rows.join("\n");
}

export interface ProviderWorld {
  readonly xtream: Record<string, Json>;
  readonly playlist: string;
  readonly guide: string;
  readonly now: number;
}

function buildWorld(): ProviderWorld {
  const liveData = liveWorld();
  const vodData = vodWorld();
  const seriesData = seriesWorld();
  const xtream: Record<string, Json> = {
    "get_live_categories|": liveData.categories,
    "get_vod_categories|": vodData.categories,
    "get_series_categories|": seriesData.categories,
  };
  for (const [category, list] of Object.entries(liveData.streams)) xtream[`get_live_streams|${category}`] = list;
  for (const [category, list] of Object.entries(vodData.streams)) {
    xtream[`get_vod_streams|${category}`] = list;
    for (const entry of list as { stream_id: number; name: string }[]) {
      xtream[`get_vod_info|${entry.stream_id}`] = { info: { plot: `Plot of ${entry.name}`, duration_secs: entry.stream_id % 4 === 0 ? "" : 5400 + entry.stream_id }, movie_data: { container_extension: entry.stream_id % 7 === 0 ? "avi" : "" } };
    }
  }
  for (const [category, list] of Object.entries(seriesData.list)) xtream[`get_series|${category}`] = list;
  for (const [seriesId, info] of Object.entries(seriesData.info)) xtream[`get_series_info|${seriesId}`] = info;
  return { xtream, playlist: PLAYLIST_TEXT, guide: guideText(), now: FIXED_NOW };
}

// ---------------------------------------------------------------------------------------------
// the database

type Row = Record<string, unknown>;

/** Every table's rows, in insertion order. Search indexes and SQLite's own tables are left out. */
export function dumpDatabase(db: Database.Database): Record<string, Row[]> {
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' ORDER BY name`).all() as { name: string }[]).map((row) => row.name);
  const out: Record<string, Row[]> = {};
  for (const table of tables) out[table] = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Row[];
  return out;
}

function installWorld(world: ProviderWorld): void {
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.host === "lists.example") return new Response(world.playlist);
    if (url.pathname.endsWith("/xmltv.php")) return new Response(world.guide);
    const action = url.searchParams.get("action") ?? "";
    const key = `${action}|${url.searchParams.get("category_id") ?? url.searchParams.get("series_id") ?? url.searchParams.get("vod_id") ?? url.searchParams.get("stream_id") ?? ""}`;
    const body = world.xtream[key];
    if (body === undefined) return new Response("not found", { status: 404 });
    return Response.json(body);
  });
}

const stream = (text: string): ReadableStream<Uint8Array> => new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });

export async function buildDbVectors(): Promise<Record<string, unknown>> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
  const world = buildWorld();
  installWorld(world);
  try {
    const db = migrateDatabase(new Database(":memory:"));
    const credentials = async () => ({ baseUrl: XTREAM.baseUrl, username: XTREAM.username, password: XTREAM.password });
    const deps = { xtreamAdapter: createXtreamAdapter(credentials), m3uAdapter: createM3UAdapter(), getCredentials: credentials };

    db.prepare(`INSERT INTO sources (id, kind, name, base_url, created_at, remote_key, sync_updated_at) VALUES (?, 'xtream', 'Panel', ?, ?, 'rk-x1', 10)`).run(XTREAM.id, XTREAM.baseUrl, FIXED_NOW);
    db.prepare(`INSERT INTO sources (id, kind, name, playlist_url, created_at, remote_key, sync_updated_at) VALUES (?, 'm3u', 'Playlist', ?, ?, 'rk-m1', 20)`).run(PLAYLIST.id, PLAYLIST.url, FIXED_NOW + 1);
    const catalogueSource = (row: { id: string; kind: "xtream" | "m3u"; name: string; base?: string; url?: string }): CatalogueSource =>
      (row.kind === "xtream"
        ? { id: row.id, kind: "xtream", name: row.name, baseUrl: row.base!, includeLive: 1, includeMovies: 1, includeSeries: 1 }
        : { id: row.id, kind: "m3u", name: row.name, playlistUrl: row.url!, includeLive: 1, includeMovies: 1, includeSeries: 1 }) as CatalogueSource;

    const result1 = await importCatalogue(db, catalogueSource({ id: XTREAM.id, kind: "xtream", name: "Panel", base: XTREAM.baseUrl }), deps);
    const result2 = await importCatalogue(db, catalogueSource({ id: PLAYLIST.id, kind: "m3u", name: "Playlist", url: PLAYLIST.url }), deps);
    await runDeferredCatalogueMaintenance(db);
    // A second refresh changes nothing (and writes nothing new): the dump below is taken after it.
    await importCatalogue(db, catalogueSource({ id: XTREAM.id, kind: "xtream", name: "Panel", base: XTREAM.baseUrl }), deps);

    await importEpg(db, XTREAM.id, stream(world.guide), { horizonMs: 36 * 3_600_000 });

    const xtreamSource = { id: XTREAM.id, kind: "xtream", name: "Panel", baseUrl: XTREAM.baseUrl } as const;
    const movieIds = (db.prepare(`SELECT id FROM movies WHERE source_id = ? ORDER BY rowid LIMIT 5`).all(XTREAM.id) as { id: string }[]).map((row) => row.id);
    for (const id of movieIds) await ensureMovieDetails(db, xtreamSource, id, credentials);
    const seriesIds = (db.prepare(`SELECT id FROM series WHERE source_id = ? ORDER BY rowid`).all(XTREAM.id) as { id: string }[]).map((row) => row.id);
    for (const id of seriesIds.slice(0, 9)) await ensureSeriesEpisodes(db, xtreamSource, id, credentials);

    const imported = { dump: dumpDatabase(db), results: [result1, result2].map(({ durationMs: _d, ...rest }) => rest), movieIds, detailSeriesIds: seriesIds.slice(0, 9) };

    // ---- user actions: concrete ids picked from the imported data, recorded so Kotlin replays exactly the same calls.
    const one = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { id: string } | undefined)?.id as string;
    const channelOf = (needle: string) => one(`SELECT id FROM channels WHERE source_id = ? AND normalised_name LIKE ? ORDER BY rowid`, XTREAM.id, `%${needle}%`);
    const tnt1 = channelOf("TNT Sports 1");
    const sky = channelOf("Sky Sports Main");
    const cnn = channelOf("CNN");
    const bbc = one(`SELECT id FROM channels WHERE source_id = ? AND normalised_name LIKE '%BBC%'`, PLAYLIST.id);
    const sportsCategory = one(`SELECT id FROM categories WHERE source_id = ? AND raw_name LIKE 'UK|%'`, XTREAM.id);
    const newsCategory = one(`SELECT id FROM categories WHERE source_id = ? AND raw_name LIKE 'US|%'`, XTREAM.id);
    const kidsMovies = one(`SELECT id FROM movie_categories WHERE source_id = ? AND raw_name LIKE 'FR%'`, XTREAM.id);
    const asiaMovies = one(`SELECT id FROM movie_categories WHERE source_id = ? AND raw_name LIKE 'ASIA%'`, XTREAM.id);
    const dramaSeriesCategory = one(`SELECT id FROM series_categories WHERE source_id = ? AND raw_name LIKE '%DRAMA'`, XTREAM.id);
    const movie = (name: string) => one(`SELECT id FROM movies WHERE source_id = ? AND name = ?`, XTREAM.id, name);
    const show = (name: string) => one(`SELECT id FROM series WHERE source_id = ? AND name = ?`, XTREAM.id, name);
    const episodeOf = (showId: string, season: number, n: number) => one(`SELECT e.id FROM episodes e JOIN seasons s ON s.id = e.season_id WHERE e.series_id = ? AND s.season_number = ? AND e.episode_number = ?`, showId, season, n);
    const action1 = movie("Action Film 1 (2020)");
    const action2 = movie("Action Film 2 (2020)");
    const comedy1 = movie("Comedy Film 1");
    const drama1 = show("Drama Show 1 (2019)");
    const drama2 = show("Drama Show 2 (2019)");
    const kids1 = show("Kids Show 1");

    type Action = { fn: string; args: unknown[] };
    const actions: Action[] = [
      { fn: "toggleFavourite", args: [tnt1] },
      { fn: "toggleFavourite", args: [sky] },
      { fn: "toggleFavourite", args: [cnn] },
      { fn: "toggleFavourite", args: [bbc] },
      { fn: "moveFavourite", args: [cnn, -1] },
      { fn: "toggleFavourite", args: [bbc] },
      { fn: "recordRecent", args: [sky] },
      { fn: "recordRecent", args: [cnn] },
      { fn: "removeChannelFromRecents", args: [cnn] },
      { fn: "toggleMovieFavourite", args: [action1] },
      { fn: "toggleMovieFavourite", args: [comedy1] },
      { fn: "toggleMovieFavourite", args: [comedy1] },
      { fn: "recordMovieRecent", args: [action1] },
      { fn: "recordMovieRecent", args: [action2] },
      { fn: "toggleSeriesFavourite", args: [drama1] },
      { fn: "recordSeriesRecent", args: [drama1] },
      { fn: "recordSeriesRecent", args: [kids1] },
      { fn: "setPlaybackProgress", args: ["movie", action1, 1200, 5400] },
      { fn: "setPlaybackProgress", args: ["movie", action2, 5300, 5400] },
      { fn: "setPlaybackProgress", args: ["episode", episodeOf(drama1, 1, 1), 2000, 2700] },
      { fn: "setPlaybackProgress", args: ["episode", episodeOf(drama1, 1, 2), 100, 2700] },
      { fn: "setWatched", args: ["episode", [episodeOf(drama1, 1, 3)], true] },
      { fn: "setWatched", args: ["movie", [comedy1], true] },
      { fn: "setWatched", args: ["movie", [comedy1], false] },
      { fn: "clearPlaybackProgress", args: ["movie", [action2]] },
      { fn: "hideCategory", args: ["movies", asiaMovies, "ASIA MOVIES (MULTI-SUBS)"] },
      { fn: "hideCategory", args: ["live", newsCategory, "US| NEWS ᴴᴰ"] },
      // hideChannel is left out: better-sqlite3 cuts the embedded NUL-bearing id out of the SQL (the device swaps NUL for U+0001; Kotlin tests it alone).
      { fn: "pinCategory", args: ["live", sportsCategory, "UK| SPORTS"] },
      { fn: "pinCategory", args: ["movies", kidsMovies, "FR - COMEDIE"] },
      { fn: "pinCategory", args: ["series", dramaSeriesCategory, "EN - DRAMA"] },
      { fn: "unpinCategory", args: ["movies", kidsMovies] },
      { fn: "saveSkipWindow", args: [drama1, 12, 95] },
      { fn: "moveSource", args: [PLAYLIST.id, -1] },
      { fn: "saveProfile", args: [{ id: "pkids", name: "Kids", colour: 2, avatar: "fox", pin: "00ff00ff", position: 1 }] },
    ];
    const apply = (action: Action) => {
      const [a, b, c, d] = action.args as [never, never, never, never];
      switch (action.fn) {
        case "toggleFavourite": return live.toggleFavourite(db, a);
        case "moveFavourite": return live.moveFavourite(db, a, b);
        case "recordRecent": return live.recordRecent(db, a);
        case "removeChannelFromRecents": return live.removeChannelFromRecents(db, a);
        case "toggleMovieFavourite": return vod.toggleMovieFavourite(db, a);
        case "recordMovieRecent": return vod.recordMovieRecent(db, a);
        case "toggleSeriesFavourite": return series.toggleSeriesFavourite(db, a);
        case "recordSeriesRecent": return series.recordSeriesRecent(db, a);
        case "setPlaybackProgress": return setPlaybackProgress(db, a, b, c, d);
        case "setWatched": return setWatched(db, a, b, c);
        case "clearPlaybackProgress": return clearPlaybackProgress(db, a, b);
        case "hideCategory": return hideCategory(db, a, b, c);
        case "hideChannel": return hideChannel(db, a, b);
        case "pinCategory": return pinCategory(db, a, b, c);
        case "unpinCategory": return unpinCategory(db, a, b);
        case "saveSkipWindow": return series.saveSkipWindow(db, a, b, c);
        case "moveSource": return moveSource(db, a, b);
        case "saveProfile": return saveProfile(db, a);
        default: throw new Error(`unknown action ${action.fn}`);
      }
    };
    for (const action of actions) {
      // Each call at its own moment, so rows differ in their clocks the way real use does.
      vi.advanceTimersByTime(1000);
      apply(action);
    }
    // A profile swap and back: personal rows go to the stash and return.
    vi.advanceTimersByTime(1000);
    actions.push({ fn: "swapProfile", args: ["main", "pkids", PROFILE_META_KEYS] });
    swapProfile(db, "main", "pkids", PROFILE_META_KEYS);
    const midSwap = dumpDatabase(db);
    vi.advanceTimersByTime(1000);
    actions.push({ fn: "swapProfile", args: ["pkids", "main", PROFILE_META_KEYS] });
    swapProfile(db, "pkids", "main", PROFILE_META_KEYS);
    const afterActions = dumpDatabase(db);

    // ---- queries over the final database
    const queries: { fn: string; in: unknown[]; out: unknown }[] = [];
    const q = (fn: string, args: unknown[], run: () => unknown) => queries.push({ fn, in: args, out: JSON.parse(JSON.stringify(run() ?? null)) });
    const channelIds = (db.prepare(`SELECT id FROM channels ORDER BY rowid`).all() as { id: string }[]).map((row) => row.id);
    const firstIds = channelIds.slice(0, 24);
    const sourceCategory = one(`SELECT id FROM categories WHERE source_id = ? AND raw_name LIKE '%MOVIES%'`, XTREAM.id);
    const playlistCategory = one(`SELECT id FROM categories WHERE source_id = ? ORDER BY rowid LIMIT 1`, PLAYLIST.id);

    q("browseChannels", [{ categoryId: sportsCategory }], () => live.browseChannels(db, { categoryId: sportsCategory }));
    q("browseChannels", [{ categoryId: sportsCategory, limit: 3, offset: 2 }], () => live.browseChannels(db, { categoryId: sportsCategory, limit: 3, offset: 2 }));
    q("browseChannels", [{ categoryId: sourceCategory }], () => live.browseChannels(db, { categoryId: sourceCategory }));
    q("browseChannels", [{ categoryId: playlistCategory }], () => live.browseChannels(db, { categoryId: playlistCategory }));
    q("browseChannels", [{ country: "UK" }], () => live.browseChannels(db, { country: "UK" }));
    q("browseChannels", [{ country: null }], () => live.browseChannels(db, {}));
    q("browseChannels", [{ sourceId: PLAYLIST.id }], () => live.browseChannels(db, { sourceId: PLAYLIST.id }));
    q("browseChannels", [{ genre: "sports" }], () => live.browseChannels(db, { genre: "sports" }));
    q("listCategories", [], () => live.listCategories(db));
    q("listCategories", [XTREAM.id], () => live.listCategories(db, XTREAM.id));
    q("listCategories", [PLAYLIST.id], () => live.listCategories(db, PLAYLIST.id));
    q("listRecentChannels", [], () => live.listRecentChannels(db));
    q("listFavouriteChannels", [], () => live.listFavouriteChannels(db));
    q("listChannelCountries", [], () => live.listChannelCountries(db));
    q("listChannelCountries", [PLAYLIST.id], () => live.listChannelCountries(db, PLAYLIST.id));
    for (const text of ["tnt", "sky spo", "bbc", "fox", "  ", "tnt*\"", "movie ch"]) q("searchChannels", [text], () => live.searchChannels(db, text));
    q("searchChannels", ["sports", 3, XTREAM.id], () => live.searchChannels(db, "sports", 3, XTREAM.id));
    q("nowNextForChannels", [firstIds, FIXED_NOW], () => [...live.nowNextForChannels(db, firstIds, FIXED_NOW)]);
    q("nowNextForChannels", [firstIds, FIXED_NOW + 5 * 3_600_000], () => [...live.nowNextForChannels(db, firstIds, FIXED_NOW + 5 * 3_600_000)]);
    q("programmesInWindow", [firstIds, FIXED_NOW - 3_600_000, FIXED_NOW + 4 * 3_600_000], () => live.programmesInWindow(db, firstIds, FIXED_NOW - 3_600_000, FIXED_NOW + 4 * 3_600_000));
    for (const id of [sky, cnn, bbc]) {
      q("getPlaybackTarget", [id], () => live.getPlaybackTarget(db, id));
      q("listChannelFeeds", [id], () => listChannelFeeds(db, id));
    }
    q("getPlaybackTarget", [tnt1, "none"], () => live.getPlaybackTarget(db, tnt1, "none"));
    q("getPlaybackTarget", ["missing"], () => live.getPlaybackTarget(db, "missing"));
    q("listChannelFeeds", [tnt1], () => listChannelFeeds(db, tnt1));
    const bt = channelOf("BT Sport");
    q("listChannelFeeds", [bt], () => listChannelFeeds(db, bt));

    q("browseMovies", [{}], () => vod.browseMovies(db, {}));
    q("browseMovies", [{ limit: 5, offset: 3 }], () => vod.browseMovies(db, { limit: 5, offset: 3 }));
    q("browseMovies", [{ sourceId: PLAYLIST.id }], () => vod.browseMovies(db, { sourceId: PLAYLIST.id }));
    q("browseMovies", [{ genre: "comedy" }], () => vod.browseMovies(db, { genre: "comedy" }));
    q("browseMovies", [{ categoryId: kidsMovies }], () => vod.browseMovies(db, { categoryId: kidsMovies }));
    q("listMovieCategories", [], () => vod.listMovieCategories(db));
    q("listMovieCategories", [PLAYLIST.id], () => vod.listMovieCategories(db, PLAYLIST.id));
    q("movieShelves", [{}], () => vod.movieShelves(db, {}));
    q("movieShelves", [{ shelves: 3, perShelf: 4, minTitles: 3 }], () => vod.movieShelves(db, { shelves: 3, perShelf: 4, minTitles: 3 }));
    for (const text of ["action", "film 1", "playlist", "xx", "comedy*"]) q("searchMovies", [text], () => vod.searchMovies(db, text));
    q("listFavouriteMovies", [], () => vod.listFavouriteMovies(db));
    q("listRecentMovies", [], () => vod.listRecentMovies(db));
    for (const id of [action1, action2, comedy1, movie("Fresh Film 1 (2026)")]) {
      q("getMovieById", [id], () => vod.getMovieById(db, id));
      q("getMoviePlaybackTarget", [id], () => vod.getMoviePlaybackTarget(db, id));
      q("listMovieVersions", [id], () => vod.listMovieVersions(db, id));
      q("listMoviePlayOrder", [id, false], () => vod.listMoviePlayOrder(db, id, false));
      q("listMoviePlayOrder", [id, true], () => vod.listMoviePlayOrder(db, id, true));
    }
    q("getMovieById", ["missing"], () => vod.getMovieById(db, "missing"));

    q("browseSeries", [{}], () => series.browseSeries(db, {}));
    q("browseSeries", [{ limit: 4, offset: 1, categoryId: dramaSeriesCategory }], () => series.browseSeries(db, { limit: 4, offset: 1, categoryId: dramaSeriesCategory }));
    q("browseSeries", [{ sourceId: PLAYLIST.id }], () => series.browseSeries(db, { sourceId: PLAYLIST.id }));
    q("listSeriesCategories", [], () => series.listSeriesCategories(db));
    q("seriesShelves", [{ minTitles: 3 }], () => series.seriesShelves(db, { minTitles: 3 }));
    for (const text of ["drama", "show 1", "playlist"]) q("searchSeries", [text], () => series.searchSeries(db, text));
    q("listFavouriteSeries", [], () => series.listFavouriteSeries(db));
    q("listRecentSeries", [], () => series.listRecentSeries(db));
    const allSeries = (db.prepare(`SELECT id FROM series ORDER BY rowid`).all() as { id: string }[]).map((row) => row.id);
    for (const id of [drama1, drama2, show("Drama Show 3 (2019)"), kids1, show("Kids Show 2"), show("4K-TOP - Drama Show 1 (2019)"), allSeries[allSeries.length - 1]!]) {
      q("getSeriesDetail", [id], () => series.getSeriesDetail(db, id));
      q("getUpNextEpisode", [id], () => series.getUpNextEpisode(db, id));
      q("listSeriesVersions", [id], () => series.listSeriesVersions(db, id));
      q("getSeriesSource", [id], () => series.getSeriesSource(db, id));
      q("getSkipWindow", [id], () => series.getSkipWindow(db, id));
      const versions = series.listSeriesVersions(db, id).map((row) => row.id);
      const detail = series.getSeriesDetail(db, id);
      q("withBorrowedSeasons", [id, versions], () => (detail === undefined ? null : series.withBorrowedSeasons(db, detail, versions)));
    }
    q("getUpNextEpisodes", [allSeries], () => [...series.getUpNextEpisodes(db, allSeries)]);
    const eps = (db.prepare(`SELECT id FROM episodes ORDER BY rowid LIMIT 40`).all() as { id: string }[]).map((row) => row.id);
    for (const id of eps.filter((_, index) => index % 4 === 0)) {
      q("findNextEpisode", [id], () => series.findNextEpisode(db, id));
      q("getEpisodePlaybackTarget", [id], () => series.getEpisodePlaybackTarget(db, id));
    }

    q("movieHome", [{ perShelf: 4, minTitles: 3 }], () => movieHome(db, { perShelf: 4, minTitles: 3 }));
    q("movieHome", [{ year: 2026, perShelf: 5, minTitles: 3 }], () => movieHome(db, { year: 2026, perShelf: 5, minTitles: 3 }));
    q("movieHome", [{ language: "en", sourceId: XTREAM.id }], () => movieHome(db, { language: "en", sourceId: XTREAM.id }));
    q("seriesHome", [{ perShelf: 4, minTitles: 3 }], () => seriesHome(db, { perShelf: 4, minTitles: 3 }));
    q("seriesHome", [{ year: 2026, perShelf: 4, minTitles: 2, genres: 2 }], () => seriesHome(db, { year: 2026, perShelf: 4, minTitles: 2, genres: 2 }));
    q("listWatchedLately", [], () => listWatchedLately(db));
    for (const text of ["film", "drama", "tnt", "sky", "show", "ca", "x", "playlist"]) q("searchAll", [text], () => searchAll(db, text));
    q("searchAll", ["film", { sourceId: XTREAM.id, perKind: 3 }], () => searchAll(db, "film", { sourceId: XTREAM.id, perKind: 3 }));

    q("getPlaybackProgress", ["movie", action1], () => getPlaybackProgress(db, "movie", action1));
    q("getPlaybackProgress", ["movie", action2], () => getPlaybackProgress(db, "movie", action2));
    q("getPlaybackProgress", ["episode", episodeOf(drama1, 1, 3)], () => getPlaybackProgress(db, "episode", episodeOf(drama1, 1, 3)));
    q("listHidden", [], () => listHidden(db));
    q("listHomePins", [], () => listHomePins(db));
    q("pinnedCategoryIds", ["live"], () => [...pinnedCategoryIds(db, "live")]);
    q("pinnedCategoryIds", ["series"], () => [...pinnedCategoryIds(db, "series")]);
    q("orderedSourceIds", [], () => orderedSourceIds(db));
    q("listProfiles", [], () => listProfiles(db));
    // An action in the middle of the queries: the Kotlin run applies it at the same point.
    const unhideEntry = { sourceId: XTREAM.id, kind: "channel" as const, key: tnt1.slice(XTREAM.id.length + 1) };
    queries.push({ fn: "__action", in: [{ fn: "unhide", args: [unhideEntry] }], out: null });
    unhide(db, unhideEntry);
    q("listChannelFeeds", [tnt1], () => listChannelFeeds(db, tnt1));
    q("browseChannels", [{ categoryId: sportsCategory }], () => live.browseChannels(db, { categoryId: sportsCategory }));
    q("listHidden", [], () => listHidden(db));
    const afterUnhide = dumpDatabase(db);

    return {
      "db/provider": world,
      "db/imported": imported,
      "db/actions": { actions, midSwap, afterActions, afterUnhide },
      "db/queries": queries,
    };
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
}
