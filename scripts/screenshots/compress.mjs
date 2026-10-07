// Turns the raw PNGs in scripts/screenshots/raw into the site's images: at most 1600px wide, WebP, in apps/web/public/shots.
//   node scripts/screenshots/compress.mjs        prints the width and height to put in SHOTS (apps/web/src/site.ts)
import { readdirSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "..", "apps", "web", "public", "shots");
mkdirSync(out, { recursive: true });
for (const file of readdirSync(join(here, "raw")).filter((f) => f.endsWith(".png"))) {
  const info = await sharp(join(here, "raw", file)).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 85 }).toFile(join(out, basename(file, ".png") + ".webp"));
  console.log(`${basename(file, ".png")}.webp ${info.width}x${info.height} ${Math.round(info.size / 1024)} kB`);
}
