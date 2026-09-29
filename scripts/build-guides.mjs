// Builds the small per-guide files the apps fetch instead of parsing whole XMLTV guides (see
// packages/sync-schema/src/guide.ts). Run by .github/workflows/guides.yml:
//   node --experimental-strip-types --import ./scripts/ts-resolve.mjs scripts/build-guides.mjs <outDir> [guideUrl...]
// With no guide URLs it reads the ones devices have registered from the Worker's D1 (needs CLOUDFLARE_API_TOKEN).
// Writes <outDir>/guide-<hash>.json, gzipped, one per guide, and a list of what it wrote in <outDir>/built.txt.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { buildGuide } from "../packages/core/src/epg/buildGuide.ts";
import { guideFileName, isSharableGuideUrl } from "../packages/sync-schema/src/guide.ts";

const HORIZON_MS = 36 * 60 * 60 * 1000;
/** A registered address no device has asked about for this long is left alone. */
const FORGET_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
/** Guides are tens of megabytes; a source that has not delivered by now is broken. */
const FETCH_TIMEOUT_MS = 10 * 60 * 1000;

const [outDir, ...given] = process.argv.slice(2);
if (outDir === undefined) throw new Error("Usage: build-guides.mjs <outDir> [guideUrl...]");

function registered() {
  const query = `SELECT url FROM guide_sources WHERE last_seen > ${Date.now() - FORGET_AFTER_MS}`;
  const out = execFileSync("npx", ["--yes", "wrangler@3", "d1", "execute", "testcard-sync", "--remote", "--json", "--command", query], { encoding: "utf8", shell: process.platform === "win32" });
  return JSON.parse(out)[0].results.map((row) => row.url);
}

const urls = given.length > 0 ? given : registered();
mkdirSync(outDir, { recursive: true });
const built = [];
let failed = 0;
for (const url of urls) {
  // The Worker checked this when it was registered; the job does not trust the list to have been.
  if (!isSharableGuideUrl(url)) {
    console.error(`Skipping ${url}: not a public guide address`);
    continue;
  }
  try {
    const started = Date.now();
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
    const guide = await buildGuide(response.body, { now: Date.now(), horizonMs: HORIZON_MS });
    const channels = Object.keys(guide.c).length;
    if (channels === 0) throw new Error("no programmes found (not an XMLTV guide?)");
    const file = await guideFileName(url);
    const gz = gzipSync(JSON.stringify(guide));
    writeFileSync(`${outDir}/${file}`, gz);
    built.push(file);
    console.log(`${file}: ${channels} channels, ${(gz.length / 1e6).toFixed(1)} MB gzipped, ${Math.round((Date.now() - started) / 1000)}s  <- ${url}`);
  } catch (error) {
    failed += 1;
    console.error(`Failed ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
writeFileSync(`${outDir}/built.txt`, built.join("\n") + (built.length > 0 ? "\n" : ""));
// Fail the run if anything failed, but only after every other guide has been built and can still be uploaded.
if (failed > 0) process.exitCode = 1;
