// An Xtream-compatible demo provider for the website screenshots. There is no real provider, channel or logo here:
// the "channels" are themed after open movies (Blender Foundation, CC BY) and public-domain films, whose posters
// (art.mjs) double as logos, and the guide is made up from their titles. Streams redirect to public open-movie test
// streams, so the player has real pictures to show.
//
//   node scripts/screenshots/fake-provider.mjs [port]        (default 9998; login: any username and password)
//
// desktop.mjs starts it itself; for the Fire TV emulator run it by hand and use http://10.0.2.2:9998 as the server.
// URLs in the answers are built from the Host header, so they work from the PC and from the emulator alike.
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { FILMS, logo, poster } from "./art.mjs";

const CATEGORIES = {
  live: ["Open Movies", "Silent Cinema", "Classic Cinema", "Family"],
  vod: ["Open movies", "Silent classics", "Classic cinema"],
  series: [],
};

// [name, category index, [programme titles], title whose poster is the logo]
const CHANNELS = [
  ["Open Movies One", 0, ["Sintel", "Tears of Steel", "Big Buck Bunny", "Elephants Dream", "Cosmos Laundromat"], "Sintel"],
  ["Open Movies Two", 0, ["Spring", "Coffee Run", "Sprite Fright", "Charge", "Big Buck Bunny"], "Spring"],
  ["Blender Shorts", 0, ["Coffee Run", "Charge", "Sprite Fright", "Spring"], "Coffee Run"],
  ["Silent Cinema", 1, ["Metropolis", "The General", "Sherlock Jr.", "The Kid", "Safety Last!"], "Metropolis"],
  ["Chaplin Theatre", 1, ["The Kid", "The Gold Rush", "The Kid", "The Gold Rush"], "The Gold Rush"],
  ["Keaton Hour", 1, ["The General", "Sherlock Jr.", "Safety Last!"], "Sherlock Jr."],
  ["Phantom Nights", 1, ["The Phantom of the Opera", "The Cabinet of Dr. Caligari", "Night of the Living Dead"], "The Phantom of the Opera"],
  ["Classic Cinema", 2, ["His Girl Friday", "Charade", "Plan 9 from Outer Space", "Night of the Living Dead"], "Charade"],
  ["Screwball Hour", 2, ["His Girl Friday", "Charade", "His Girl Friday"], "His Girl Friday"],
  ["Midnight Movies", 2, ["Plan 9 from Outer Space", "Night of the Living Dead"], "Plan 9 from Outer Space"],
  ["Cosmos Channel", 3, ["Cosmos Laundromat", "Elephants Dream", "Tears of Steel"], "Cosmos Laundromat"],
  ["Bunny TV", 3, ["Big Buck Bunny", "Spring", "Sprite Fright"], "Big Buck Bunny"],
  ["Cinema Club", 2, ["Metropolis", "Charade", "Sintel", "The Kid"], "Tears of Steel"],
  ["Weekend Matinee", 3, ["Big Buck Bunny", "The General", "Coffee Run", "Spring"], "Elephants Dream"],
];

const MOVIES = Object.keys(FILMS).map((title) => [title, CATEGORIES.vod.indexOf(FILMS[title][2])]);
const SERIES = [];

// Open-movie test streams that allow playback from anywhere: Big Buck Bunny, Sintel and Tears of Steel.
const STREAMS = [
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
  "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
];

// Providers put the release year in the title; the apps' "new" and "top this year" shelves go by it. These are the real years.
const titled = (name) => `${name} (${FILMS[name][1]})`;
const hash = (text) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const esc = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** Plain coloured artwork for the few things that have no poster (the extra M3U channels). */
async function art(kind, title) {
  const h = hash(title);
  const hue = h % 360;
  const [w, hgt] = kind === "logo" ? [240, 240] : [400, 600];
  const initials = title.split(" ").slice(0, 2).map((x) => x[0]).join("").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}"><rect width="100%" height="100%" fill="hsl(${hue} 50% 30%)"/><text x="50%" y="58%" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="104" fill="#fff" text-anchor="middle">${esc(initials)}</text></svg>`;
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
      const minutes = [60, 90, 90, 120, 120][n % 5];
      const title = titles[n % titles.length];
      parts.push(`<programme start="${stamp(t)}" stop="${stamp(t + minutes * 60_000)}" channel="ch${i}"><title lang="en">${esc(title)}</title><desc>${esc(`${title} on ${name}.`)}</desc></programme>`);
      t += minutes * 60_000;
      n = (n * 7 + 3) >>> 0;
    }
  });
  parts.push("</tv>");
  return parts.join("\n");
}

const plotOf = (title) => {
  const f = FILMS[title];
  if (!f) return `${title}.`;
  return f[3].startsWith("CC") ? `${title} (${f[1]}), an open movie by the Blender Foundation. ${f[3]}.` : `${title} (${f[1]}), a film in the public domain.`;
};

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

    if (url.pathname === "/player_api.php") {
      const action = url.searchParams.get("action") ?? "";
      if (action === "") return json({ user_info: { auth: 1, status: "Active", exp_date: String(Math.floor(Date.now() / 1000) + 90 * 86400), max_connections: "2", active_cons: "0", is_trial: "0" } });
      if (action === "get_live_categories") return json(cats(CATEGORIES.live));
      if (action === "get_vod_categories") return json(cats(CATEGORIES.vod));
      if (action === "get_series_categories") return json(cats(CATEGORIES.series));
      if (action === "get_live_streams")
        return json(CHANNELS.map(([name, c], i) => ({ num: i + 1, name, stream_id: 100 + i, stream_icon: `${origin}/art/logo/${slug(name)}.png`, epg_channel_id: `ch${i}`, category_id: String(c + 1) })).filter((s) => pick === null || s.category_id === pick));
      if (action === "get_vod_streams")
        return json(MOVIES.map(([name, c], i) => ({ num: i + 1, name: titled(name), stream_id: 500 + i, stream_icon: `${origin}/art/poster/${slug(name)}.png`, rating: "", added, category_id: String(c + 1), container_extension: "mp4" })).filter((s) => pick === null || s.category_id === pick));
      if (action === "get_vod_info") {
        const m = MOVIES[Number(url.searchParams.get("vod_id")) - 500];
        return json({ info: { plot: plotOf(m?.[0] ?? "Film"), duration_secs: 5400 + (hash(m?.[0] ?? "") % 4) * 900, genre: CATEGORIES.vod[m?.[1] ?? 0] }, movie_data: { container_extension: "mp4" } });
      }
      if (action === "get_series") return json([]);
      if (action === "get_series_info") return json({ seasons: [], episodes: {} });
      if (action === "get_short_epg") return json({ epg_listings: [] });
      response.writeHead(404); return response.end("not found");
    }
    if (url.pathname === "/main.m3u") { response.writeHead(200, { "content-type": "audio/x-mpegurl" }); return response.end(["#EXTM3U", ...["Lowtide Radio", "Quarry Cam", "Harbour Webcam"].map((n, i) => `#EXTINF:-1 tvg-id="x${i}" tvg-logo="${origin}/art/logo/${slug(n)}.png" group-title="Extras",${n}\n${origin}/live/u/p/${900 + i}.ts`)].join("\n")); }
    if (url.pathname === "/xmltv.php") { response.writeHead(200, { "content-type": "application/xml" }); return response.end(guide); }
    const stream = /^\/live\/[^/]+\/[^/]+\/(\d+)\.(?:ts|m3u8)$/.exec(url.pathname) ?? /^\/(?:movie|series)\/[^/]+\/[^/]+\/(\d+)\.[a-z0-9]+$/.exec(url.pathname);
    if (stream) { response.writeHead(302, { location: STREAMS[Number(stream[1]) % STREAMS.length] }); return response.end(); }
    const m = /^\/art\/(logo|poster|wide)\/(.+)\.png$/.exec(url.pathname);
    if (m) {
      const channel = CHANNELS.find((c) => slug(c[0]) === m[2]);
      const film = Object.keys(FILMS).find((t) => slug(t) === m[2]);
      const extra = ["Lowtide Radio", "Quarry Cam", "Harbour Webcam"].find((t) => slug(t) === m[2]);
      if (!channel && !film && !extra) { response.writeHead(404); return response.end(); }
      const key = m[1] + m[2];
      if (!cache.has(key)) cache.set(key, (channel ? await logo(channel[3]) : film ? await poster(film) : null) ?? (await art(m[1], channel?.[0] ?? film ?? extra)));
      response.writeHead(200, { "content-type": "image/png" }); return response.end(cache.get(key));
    }
    response.writeHead(404); response.end("not found");
  });
  return new Promise((resolve) => server.listen(port, "0.0.0.0", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 9998);
  await startFakeProvider(port);
  console.log(`demo provider on http://0.0.0.0:${port}  (emulator: http://10.0.2.2:${port}, any login)`);
}
