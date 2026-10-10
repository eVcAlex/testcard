// Artwork for the demo provider: posters of open movies (Blender Foundation, Creative Commons Attribution) and of
// films in the public domain, fetched once from Wikimedia Commons and cached in raw/art (gitignored).
//
// Credit lines for the site and the README live in CREDITS below. Every file here is CC BY or public domain; check the
// licence on its Commons page before adding one.
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, "raw", "art");

/** title -> [Commons file name, year, category, licence note] */
export const FILMS = {
  "Big Buck Bunny": ["Big buck bunny poster big.jpg", 2008, "Open movies", "CC BY 3.0, Blender Foundation"],
  "Sintel": ["Sintel poster.jpg", 2010, "Open movies", "CC BY 3.0, Blender Foundation"],
  "Tears of Steel": ["Tos-poster.png", 2012, "Open movies", "CC BY 3.0, Blender Foundation"],
  "Elephants Dream": ["ElephantsDreamPoster.jpg", 2006, "Open movies", "CC BY 4.0, Blender Foundation"],
  "Cosmos Laundromat": ["CosmosLaundromatPoster.jpg", 2015, "Open movies", "CC BY 4.0, Blender Foundation"],
  "Spring": ["Spring2019PillarPosterBlender.jpg", 2019, "Open movies", "CC BY 4.0, Blender Foundation"],
  "Coffee Run": ["Coffee Run-movie poster.png", 2020, "Open movies", "CC BY 4.0, Blender Foundation"],
  "Sprite Fright": ["Sprite Fright-movie poster.jpg", 2021, "Open movies", "CC BY 4.0, Blender Foundation"],
  "Charge": ["Charge-movie poster.jpg", 2022, "Open movies", "CC BY 4.0, Blender Foundation"],
  "Metropolis": ["Boris Bilinski (1900-1948) Plakat für den Film Metropolis (1).jpg", 1927, "Silent classics", "public domain"],
  "The Cabinet of Dr. Caligari": ["The Cabinet of Doctor Caligari Movie poster.jpg", 1920, "Silent classics", "public domain"],
  "The General": ["The General (1926) - Movie Poster 2.png", 1926, "Silent classics", "public domain"],
  "Sherlock Jr.": ["Sherlock jr poster.jpg", 1924, "Silent classics", "public domain"],
  "The Kid": ["The Kid (1921) poster.jpg", 1921, "Silent classics", "public domain"],
  "Safety Last!": ["Safety last poster.jpg", 1923, "Silent classics", "public domain"],
  "The Phantom of the Opera": ["The Phantom of the Opera (1925 film).jpg", 1925, "Silent classics", "public domain"],
  "The Gold Rush": ["Gold rush poster.jpg", 1925, "Silent classics", "public domain"],
  "Night of the Living Dead": ["Night Of The Living Dead (1968) - Poster.jpg", 1968, "Classic cinema", "public domain"],
  "His Girl Friday": ["His Girl Friday (1940 poster).jpg", 1940, "Classic cinema", "public domain"],
  "Charade": ["Charade (1963 poster).jpg", 1963, "Classic cinema", "public domain"],
  "Plan 9 from Outer Space": ["Plan nine from outer space.jpg", 1957, "Classic cinema", "public domain"],
};

export const CREDITS = "Posters: open movies by the Blender Foundation (Big Buck Bunny, Sintel, Tears of Steel, Elephants Dream, Cosmos Laundromat, Spring, Coffee Run, Sprite Fright, Charge; Creative Commons Attribution) and public-domain film posters, via Wikimedia Commons.";

const UA = { "user-agent": "testcard-site-screenshots/1.0 (hello@evicted.dev)" };

/** The poster as a 400x600 PNG, downloaded on first use. */
export async function poster(title) {
  const entry = FILMS[title];
  if (!entry) return null;
  mkdirSync(cache, { recursive: true });
  const file = join(cache, title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".png");
  if (!existsSync(file)) {
    const url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(entry[0]) + "?width=800";
    const res = await fetch(url, { headers: UA, redirect: "follow" });
    if (!res.ok) throw new Error(`${title}: ${res.status} for ${entry[0]}`);
    const png = await sharp(Buffer.from(await res.arrayBuffer())).resize(400, 600, { fit: "cover", position: "top" }).png().toBuffer();
    writeFileSync(file, png);
  }
  return readFileSync(file);
}

/** A square logo cut from the top of a poster. */
export async function logo(title) {
  const p = await poster(title);
  return p ? sharp(p).resize(240, 240, { fit: "cover", position: "top" }).png().toBuffer() : null;
}
