// Writes the update manifest (latest.json) for a Fire TV build, with what changed since the build devices have now.
//   node scripts/release-manifest.mjs <build.json> <apk file name> <commit> <out file>
// "What changed" is the commit subjects between the published build's commit and this one (they are written for the
// viewer), kept for the last few builds so a device several versions behind is told all of it.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MANIFEST_URL = "https://testcard-sync.evcalex.workers.dev/app/latest.json";
const KEEP_BUILDS = 15;
const MAX_LINES = 8;

const [buildFile, apk, commit, out] = process.argv.slice(2);
if (out === undefined) throw new Error("usage: release-manifest.mjs <build.json> <apk> <commit> <out>");
const build = JSON.parse(readFileSync(buildFile, "utf8"));

let previous = null;
try {
  const response = await fetch(MANIFEST_URL, { headers: { "cache-control": "no-cache" } });
  if (response.ok) previous = await response.json();
} catch {
  // First publish, or the server is down: this build's notes alone.
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const known = (sha) => {
  try {
    git("cat-file", "-e", `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
};
const range = typeof previous?.commit === "string" && known(previous.commit) ? [`${previous.commit}..${commit}`] : ["-n", "5", commit];
const changes = [...new Set(git("log", "--no-merges", "--format=%s", ...range).split("\n").map((line) => line.trim()).filter((line) => line !== ""))].slice(0, MAX_LINES);

const history = Array.isArray(previous?.notes) ? previous.notes.filter((entry) => entry.versionCode < build.versionCode) : [];
const notes = [{ versionCode: build.versionCode, versionName: build.versionName, changes }, ...history].slice(0, KEEP_BUILDS);

writeFileSync(out, JSON.stringify({ ...build, commit, apks: { firetv: apk }, notes }));
console.log(`${build.versionName}:\n${changes.map((line) => `  - ${line}`).join("\n") || "  (no changes listed)"}`);
