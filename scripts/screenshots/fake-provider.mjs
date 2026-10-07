// An Xtream-compatible provider made entirely of invented content (channels, shows, films, artwork), for the
// website screenshots. Nothing here is a real provider, channel, film or logo. Artwork is generated with sharp.
//
//   node scripts/screenshots/fake-provider.mjs [port]        (default 9998; login: any username and password)
//
// desktop.mjs starts it itself; for the Fire TV emulator run it by hand and use http://10.0.2.2:9998 as the server.
// URLs in the answers are built from the Host header, so they work from the PC and from the emulator alike.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const CATEGORIES = {
  live: ["News and Weather", "Sport", "Movies", "Entertainment", "Kids and Music"],
  vod: ["Thrillers", "Comedies", "Family"],
  series: ["Drama", "Documentary"],
};

// [name, category index, [programme titles]]
const CHANNELS = [
  ["Harbour News", 0, ["Harbour News Live", "Morning Briefing", "Business Tonight", "The Week Ahead", "Harbour News at Six"]],
  ["Tidewater Weather", 0, ["Forecast Now", "Coastal Outlook", "Weather Watch", "Seven Day Planner"]],
  ["Summit Report", 0, ["Summit Report", "Question Time Live", "Policy Hour", "Late Edition"]],
  ["Peak Sport", 1, ["Peak Sport Live", "Saturday Matchday", "Cycling: Coast to Coast", "The Sports Desk", "Highlights Show"]],
  ["Peak Sport 2", 1, ["Rugby Night", "Sailing Weekly", "Tennis: Open Court", "Athletics Special"]],
  ["Late Night Cinema", 2, ["The Salt Meridian", "Copper Sky", "Paper Lanterns", "Last Train to Marrow", "Glass Orchard"]],
  ["Paper Moon Films", 2, ["Northbound Tide", "A Hundred Small Fires", "Velvet Static", "The Quiet Engine"]],
  ["Studio 9", 3, ["Studio 9 Breakfast", "The Quiz Factory", "Kitchen Table", "Fox Hollow", "Saturday Night Studio"]],
  ["Lantern Drama", 3, ["Quarry Lane", "The Lantern Club", "Night Shift Kitchen", "Orbit Street"]],
  ["Nova Science", 3, ["How Things Float", "The Cartographers", "Deep Field", "Signal Fires"]],
  ["Marmalade Kitchen", 3, ["Bake Along", "One Pan Wonders", "Market Day", "Sunday Roast Club"]],
  ["Kite Kids", 4, ["Pip and the Paper Boat", "Little Comet", "Story Corner", "Mossy Hill Friends"]],
  ["Orchard Music", 4, ["Orchard Sessions", "Top Twenty Countdown", "Unplugged", "Vinyl Hour"]],
  ["Ember Classics", 2, ["Ember Classics", "Matinee Double", "Golden Hour Cinema", "Mystery Theatre"]],
];

const MOVIES = [
  ["The Salt Meridian", 0], ["Copper Sky", 0], ["Last Train to Marrow", 0], ["Glass Orchard", 0], ["The Quiet Engine", 0], ["Night Ferry", 0],
  ["Paper Lanterns", 1], ["A Hundred Small Fires", 1], ["Velvet Static", 1], ["Moth and Compass", 1], ["The Long Thaw", 1], ["Spare Keys", 1],
  ["Northbound Tide", 2], ["Harbour Lights", 2], ["The Kite Season", 2], ["Pip and the Paper Boat", 2], ["Mossy Hill", 2], ["Little Comet", 2],
];

const SERIES = [
  ["Quarry Lane", 0], ["The Lantern Club", 0], ["Night Shift Kitchen", 0], ["Fox Hollow", 0], ["Orbit Street", 0], ["Signal Fires", 0],
  ["The Cartographers", 1], ["How Things Float", 1], ["Deep Field", 1], ["Coast to Coast", 1],
];

// Providers put the release year in the title; the apps' "new" and "top this year" shelves go by it.
const titled = (name, i) => `${name} (${2026 - (i % 3)})`;
const hash = (text) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const esc = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Generic coloured artwork: a gradient with a few shapes and the title. No imagery from anywhere. */
async function art(kind, title) {
  const h = hash(title);
  const hue = h % 360;
  const [w, hgt] = kind === "logo" ? [240, 240] : kind === "wide" ? [640, 360] : [400, 600];
  const c1 = `hsl(${hue} 55% 38%)`;
  const c2 = `hsl(${(hue + 50) % 360} 60% 18%)`;
  const shapes = [0, 1, 2].map((i) => {
    const x = ((h >> (i * 3)) % 80) / 100 * w;
    const y = ((h >> (i * 4 + 1)) % 80) / 100 * hgt;
    const r = (0.15 + (((h >> (i + 2)) % 30) / 100)) * Math.min(w, hgt);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="hsl(${(hue + 30 * i + 20) % 360} 70% 62%)" opacity="0.25"/>`;
  }).join("");
  const words = title.split(" ");
  const initials = words.slice(0, 2).map((x) => x[0]).join("").toUpperCase();
  const text = kind === "logo"
    ? `<text x="50%" y="58%" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="104" fill="#fff" text-anchor="middle">${esc(initials)}</text>`
    : (() => {
        const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : words;
        const size = kind === "wide" ? 44 : 40;
        return lines.map((l, i) => `<text x="50%" y="${kind === "wide" ? 190 + i * 52 : 470 + i * 48}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="#fff" text-anchor="middle">${esc(l)}</text>`).join("");
      })();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${shapes}${text}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const HOUR = 3600_000;
const stamp = (t) => new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";

function guideXml() {
  const first = Math.floor(Date.now() / HOUR) * HOUR - 14 * HOUR;
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', "<tv>"];
  CHANNELS.forEach(([name], i) => parts.push(`<channel id="ch${i}"><display-name>${esc(name)}</display-name></channel>`));
  CHANNELS.forEach(([name, , titles], i) => {
    let t = first, n = hash(name);
    while (t < first + 60 * HOUR) {
      const minutes = [30, 60, 60, 90, 120][n % 5];
      const title = titles[n % titles.length];
      parts.push(`<programme start="${stamp(t)}" stop="${stamp(t + minutes * 60_000)}" channel="ch${i}"><title lang="en">${esc(title)}</title><desc>${esc(`${title} on ${name}.`)}</desc></programme>`);
      t += minutes * 60_000;
      n = (n * 7 + 3) >>> 0;
    }
  });
  parts.push("</tv>");
  return parts.join("\n");
}

const plotOf = (title) => `${title}: an invented story for the Testcard demo library.`;

export function startFakeProvider(port = 9998) {
  const guide = guideXml();
  const cache = new Map();
  const added = String(Math.floor(Date.now() / 1000) - 86400);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const origin = `http://${request.headers.host}`;
    if (process.env.VERBOSE) console.log(request.url);
    const json = (body) => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
    const cats = (names) => names.map((n, i) => ({ category_id: String(i + 1), category_name: n, parent_id: 0 }));
    const pick = url.searchParams.get("category_id");
    const inCat = (list, i) => pick === null || pick === String(i + 1);

    if (url.pathname === "/player_api.php") {
      const action = url.searchParams.get("action") ?? "";
      if (action === "") return json({ user_info: { auth: 1, status: "Active", exp_date: String(Math.floor(Date.now() / 1000) + 90 * 86400), max_connections: "2", active_cons: "0", is_trial: "0" } });
      if (action === "get_live_categories") return json(cats(CATEGORIES.live));
      if (action === "get_vod_categories") return json(cats(CATEGORIES.vod));
      if (action === "get_series_categories") return json(cats(CATEGORIES.series));
      if (action === "get_live_streams")
        return json(CHANNELS.map(([name, c], i) => ({ num: i + 1, name, stream_id: 100 + i, stream_icon: `${origin}/art/logo/${slug(name)}.png`, epg_channel_id: `ch${i}`, category_id: String(c + 1) })).filter((s) => pick === null || s.category_id === pick));
      if (action === "get_vod_streams")
        return json(MOVIES.map(([name, c], i) => ({ num: i + 1, name: titled(name, i), stream_id: 500 + i, stream_icon: `${origin}/art/poster/${slug(name)}.png`, rating: (6 + (hash(name) % 30) / 10).toFixed(1), added, category_id: String(c + 1), container_extension: "mp4" })).filter((s) => pick === null || s.category_id === pick));
      if (action === "get_vod_info") {
        const m = MOVIES[Number(url.searchParams.get("vod_id")) - 500];
        return json({ info: { plot: plotOf(m?.[0] ?? "Film"), duration_secs: 5400 + (hash(m?.[0] ?? "") % 4) * 900, genre: CATEGORIES.vod[m?.[1] ?? 0] }, movie_data: { container_extension: "mp4" } });
      }
      if (action === "get_series")
        return json(SERIES.map(([name, c], i) => ({ num: i + 1, name: titled(name, i), series_id: 800 + i, cover: `${origin}/art/poster/${slug(name)}.png`, plot: plotOf(name), rating: (6 + (hash(name) % 30) / 10).toFixed(1), last_modified: added, category_id: String(c + 1) })).filter((s) => pick === null || s.category_id === pick));
      if (action === "get_series_info") {
        const id = Number(url.searchParams.get("series_id"));
        const name = SERIES[id - 800]?.[0] ?? "Series";
        const seasons = [1, 2].map((n) => ({ season_number: n, name: `Season ${n}` }));
        const episodes = Object.fromEntries([1, 2].map((s) => [String(s), Array.from({ length: 6 }, (_, e) => ({ id: `${id}${s}${e + 1}`, episode_num: e + 1, title: `${name} S${s}E${e + 1}`, container_extension: "mp4", season: s, info: { duration_secs: 2700, plot: `Episode ${e + 1} of ${name}.` } }))]));
        return json({ seasons, episodes });
      }
      if (action === "get_short_epg") return json({ epg_listings: [] });
      response.writeHead(404); return response.end("not found");
    }
    if (url.pathname === "/main.m3u") { response.writeHead(200, { "content-type": "audio/x-mpegurl" }); return response.end(["#EXTM3U", ...["Lowtide Radio", "Quarry Cam", "Harbour Webcam"].map((n, i) => `#EXTINF:-1 tvg-id="x${i}" tvg-logo="${origin}/art/logo/${slug(n)}.png" group-title="Extras",${n}\n${origin}/live/u/p/${900 + i}.ts`)].join("\n")); }
    if (url.pathname === "/xmltv.php") { response.writeHead(200, { "content-type": "application/xml" }); return response.end(guide); }
    const m = /^\/art\/(logo|poster|wide)\/(.+)\.png$/.exec(url.pathname);
    if (m) {
      const all = ["Lowtide Radio", "Quarry Cam", "Harbour Webcam", ...CHANNELS.map((c) => c[0]), ...MOVIES.map((c) => c[0]), ...SERIES.map((c) => c[0])];
      const title = all.find((t) => slug(t) === m[2]);
      if (title === undefined) { response.writeHead(404); return response.end(); }
      const key = m[1] + m[2];
      if (!cache.has(key)) cache.set(key, await art(m[1], title));
      response.writeHead(200, { "content-type": "image/png" }); return response.end(cache.get(key));
    }
    response.writeHead(404); response.end("not found");
  });
  return new Promise((resolve) => server.listen(port, "0.0.0.0", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 9998);
  await startFakeProvider(port);
  console.log(`invented provider on http://0.0.0.0:${port}  (emulator: http://10.0.2.2:${port}, any login)`);
}
