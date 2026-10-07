// Builds the site: copies src/ to dist/ and brings in the Inter font from the desktop app, so the
// website and the app share one copy of it. No dependencies.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const dist = join(root, "dist");
const fonts = join(root, "..", "desktop", "src", "renderer", "src", "assets", "fonts");

rmSync(dist, { recursive: true, force: true });
cpSync(src, dist, { recursive: true });

mkdirSync(join(dist, "fonts"), { recursive: true });
for (const name of ["InterVariable.woff2", "OFL.txt"]) {
  const from = join(fonts, name);
  if (!existsSync(from)) {
    console.error(`build: missing ${from}. The website reuses the desktop app's Inter font files.`);
    process.exit(1);
  }
  cpSync(from, join(dist, "fonts", name));
}
console.log("website built to", dist);
