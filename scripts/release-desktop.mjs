// Publishes the desktop installer to the release bucket the app updates from (ADR 0010).
//   pnpm release:desktop            uploads what `pnpm --filter @testcard/desktop package` last built
// Build first (bump apps/desktop/package.json "version": an app only updates to a higher one). Needs wrangler
// signed in to Cloudflare. No secrets are stored.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BUCKET = "testcard-releases";
const RELEASE_DIR = "release";
const run = (command, args) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" });

const manifestPath = join(RELEASE_DIR, "latest.yml");
if (!existsSync(manifestPath)) throw new Error("No release/latest.yml. Run: pnpm --filter @testcard/desktop package");
const manifest = readFileSync(manifestPath, "utf8");
const installer = /^path: (.+)$/m.exec(manifest)?.[1]?.trim();
const version = /^version: (.+)$/m.exec(manifest)?.[1]?.trim();
if (installer === undefined || version === undefined) throw new Error("release/latest.yml has no version or path.");
// The bucket only serves plain file names (routes/release.ts).
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(installer)) throw new Error(`Installer name "${installer}" has characters the release bucket will not serve.`);
if (!existsSync(join(RELEASE_DIR, installer))) throw new Error(`release/${installer} is missing.`);

const put = (key, file, contentType) =>
  run("pnpm", ["--filter", "@testcard/sync-worker", "exec", "wrangler", "r2", "object", "put", `${BUCKET}/${key}`, "--file", resolve(file), "--content-type", contentType]);

// The installer first, so a running app never reads a manifest that points at a file that is not there yet.
console.log(`Uploading ${installer}`);
put(installer, join(RELEASE_DIR, installer), "application/vnd.microsoft.portable-executable");
put("latest.yml", manifestPath, "text/yaml");
console.log(`Published desktop ${version}`);
