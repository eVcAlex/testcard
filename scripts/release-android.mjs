// Publishes the latest built APKs to the release bucket the app updates from (ADR 0010).
//   pnpm release:android            the newest successful "Android APK" run
//   pnpm release:android <run-id>   a specific run
// Needs `gh` (signed in) and wrangler (signed in to Cloudflare, R2 enabled). No secrets are stored.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUCKET = "testcard-releases";
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32", ...options });

const runId = process.argv[2] ?? run("gh", ["run", "list", "--workflow", "android-apk.yml", "--status", "success", "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId"]).trim();
if (runId === "") throw new Error("No successful Android APK run found.");
console.log(`Using run ${runId}`);

const dir = mkdtempSync(join(tmpdir(), "testcard-release-"));
run("gh", ["run", "download", runId, "-D", dir]);
const build = JSON.parse(readFileSync(join(dir, "testcard-firetv", "build.json"), "utf8"));

const put = (key, file, contentType) =>
  run("pnpm", ["--filter", "@testcard/sync-worker", "exec", "wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", contentType, "--remote"]);

// The APKs first, so a device never sees a manifest that points at a file that is not there yet.
for (const target of ["firetv", "phone"]) {
  console.log(`Uploading testcard-${target}.apk`);
  put(`testcard-${target}.apk`, join(dir, `testcard-${target}`, `testcard-${target}.apk`), "application/vnd.android.package-archive");
}
const manifest = join(dir, "latest.json");
writeFileSync(manifest, JSON.stringify({ ...build, apks: { firetv: "testcard-firetv.apk", phone: "testcard-phone.apk" } }));
put("latest.json", manifest, "application/json");
console.log(`Published ${build.versionName} (versionCode ${build.versionCode})`);
