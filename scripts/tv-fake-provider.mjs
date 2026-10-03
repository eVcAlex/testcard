#!/usr/bin/env node
// A fake Xtream provider for developing and testing the native TV app without a real subscription. It answers
// `player_api.php` (every action the importers use), a playlist at /main.m3u and a guide at /xmltv.php from the provider
// world in packages/core/test-vectors/db/provider.json, so what the app shows is the data the database vectors are built on.
// Stream URLs (/live/..., /movie/..., /series/...) redirect to a public test stream, or to STREAM_URL when set.
//
//   node scripts/tv-fake-provider.mjs [port]      (default 9999; the emulator reaches the host as http://10.0.2.2:9999)
//   login: any username and password (u / p in the vectors)
import { createServer } from "node:http";
import { readFileSync, statSync, createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const world = JSON.parse(readFileSync(join(here, "..", "packages", "core", "test-vectors", "db", "provider.json"), "utf8"));
// BIG_SERIES=1 gives series 801 four seasons of 30 episodes, to drive the episode grid by remote (it scrolls).
if (process.env.BIG_SERIES) {
  const info = world.xtream["get_series_info|801"];
  info.seasons = [1, 2, 3, 4].map((n) => ({ season_number: n, name: `Season ${n}` }));
  info.episodes = Object.fromEntries([1, 2, 3, 4].map((n) => [String(n), Array.from({ length: 30 }, (_, i) => ({ id: `8${n}${String(i + 1).padStart(3, "0")}`, episode_num: i + 1, title: `Drama Show 1 (2019) S${n}E${i + 1}`, container_extension: "mp4", season: n, info: { duration_secs: 2700, plot: `Episode ${i + 1}` } }))]));
}
const port = Number(process.argv[2] ?? 9999);
// SAMPLE_FILE: a local video the provider serves itself at /sample.mp4 (with ranges, so seeking works), used when STREAM_URL is not set.
const sampleFile = process.env.SAMPLE_FILE;
const stream = process.env.STREAM_URL ?? (sampleFile ? `http://10.0.2.2:${process.argv[2] ?? 9999}/sample.mp4` : "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8");

const userInfo = { user_info: { auth: 1, status: "Active", exp_date: String(Math.floor(Date.now() / 1000) + 90 * 86400), max_connections: "2", active_cons: "0", is_trial: "0" } };

createServer((request, response) => {
  if (process.env.VERBOSE) console.log(request.method, request.url);
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const send = (body, type = "application/json") => {
    response.writeHead(200, { "content-type": type });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  if (url.pathname === "/player_api.php") {
    const action = url.searchParams.get("action") ?? "";
    if (action === "") return send(userInfo);
    const argument = url.searchParams.get("category_id") ?? url.searchParams.get("series_id") ?? url.searchParams.get("vod_id") ?? url.searchParams.get("stream_id") ?? "";
    const body = world.xtream[`${action}|${argument}`];
    if (body === undefined) {
      // A short guide for any channel, so the on-now strip has something without an imported guide.
      if (action === "get_short_epg") return send({ epg_listings: [] });
      response.writeHead(404);
      return response.end("not found");
    }
    return send(body);
  }
  if (url.pathname === "/main.m3u") return send(world.playlist, "audio/x-mpegurl");
  if (url.pathname === "/xmltv.php") return send(world.guide, "application/xml");
  if (sampleFile && url.pathname === "/sample.mp4") {
    const size = statSync(sampleFile).size;
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.range ?? "");
    const start = range?.[1] ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : size - 1;
    response.writeHead(range ? 206 : 200, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": end - start + 1, ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}) });
    return createReadStream(sampleFile, { start, end }).pipe(response);
  }
  if (/^\/(live|movie|series|timeshift)\//.test(url.pathname)) {
    response.writeHead(302, { location: stream });
    return response.end();
  }
  response.writeHead(404);
  response.end("not found");
}).listen(port, "0.0.0.0", () => console.log(`fake provider on http://0.0.0.0:${port}`));
