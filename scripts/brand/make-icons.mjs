// Generates every app icon from one drawing: the colour-bars test card (ADR 0010).
// Run with `pnpm icons`; the PNG/ICO outputs are committed, so this only reruns on a design change.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BG = "#14171a";
const TEAL = "#4fb3a6";
const FG = "#eef1f3";
const BARS = ["#d0d4d8", "#d9c86a", "#4fb3a6", "#6bbf6b", "#b56bbf", "#e8402a", "#4a6fd0"];
const LOWER = ["#4a6fd0", BG, "#b56bbf", BG, TEAL, BG, "#d0d4d8"];
const BAR_W = 320 / 7;

/** The test card, in a 512 box, centred on (256, 255). */
function testCard(id) {
  const top = BARS.map((c, i) => `<rect x="${96 + i * BAR_W}" y="120" width="${BAR_W + 0.5}" height="190" fill="${c}"/>`).join("");
  const low = LOWER.map((c, i) => `<rect x="${96 + i * BAR_W}" y="310" width="${BAR_W + 0.5}" height="36" fill="${c}"/>`).join("");
  return `<clipPath id="tc${id}"><rect x="96" y="120" width="320" height="270" rx="26"/></clipPath>
<g clip-path="url(#tc${id})">${top}${low}<rect x="96" y="346" width="320" height="44" fill="#0f1214"/><rect x="96" y="346" width="120" height="44" fill="${TEAL}"/></g>
<rect x="96" y="120" width="320" height="270" rx="26" fill="none" stroke="#2b3138" stroke-width="6"/>`;
}

/** One colour, for Android's themed icons: the frame and the bars as cut-outs. */
function testCardMono() {
  const bars = BARS.map((_, i) => `<rect x="${108 + i * BAR_W}" y="132" width="${BAR_W - 8}" height="170" rx="6" fill="#fff"/>`).join("");
  return `<rect x="96" y="120" width="320" height="270" rx="26" fill="none" stroke="#fff" stroke-width="12"/>${bars}<rect x="108" y="322" width="296" height="56" rx="8" fill="#fff"/>`;
}

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
/** The 512 drawing scaled about its centre onto a size x size canvas. */
const centred = (size, scale, inner) => `<g transform="translate(${size / 2} ${size / 2}) scale(${(size / 512) * scale}) translate(-256 -255)">${inner}</g>`;

const square = (size, scale = 1) => svg(size, size, `<rect width="${size}" height="${size}" fill="${BG}"/>${centred(size, scale, testCard("a"))}`);
const rounded = (size) => svg(size, size, `<clipPath id="r"><rect width="${size}" height="${size}" rx="${size * 0.22}"/></clipPath><g clip-path="url(#r)"><rect width="${size}" height="${size}" fill="${BG}"/>${centred(size, 1, testCard("b"))}</g>`);

const banner = svg(640, 360, `<rect width="640" height="360" fill="#1a1d21"/>
<g transform="translate(60 80)"><clipPath id="br"><rect width="200" height="200" rx="44"/></clipPath><g clip-path="url(#br)"><rect width="200" height="200" fill="${BG}"/>${centred(200, 1, testCard("c"))}</g></g>
<text x="290" y="205" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="54" fill="${FG}" letter-spacing="2">TEST<tspan fill="${TEAL}">CARD</tspan></text>`);

const out = async (svgText, ...path) => {
  const file = join(root, ...path);
  mkdirSync(dirname(file), { recursive: true });
  await sharp(Buffer.from(svgText)).png().toFile(file);
};

/** A PNG-in-ICO container: Windows has read these since Vista. */
async function ico(sizes) {
  const images = await Promise.all(sizes.map((s) => sharp(Buffer.from(rounded(s))).png().toBuffer()));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const at = 6 + i * 16;
    header.writeUInt8(s >= 256 ? 0 : s, at);
    header.writeUInt8(s >= 256 ? 0 : s, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(images[i].length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

const mobile = ["apps", "mobile", "assets"];
// Android adaptive icons are masked to a circle/squircle: keep the artwork inside the centre 66%.
await out(square(1024), ...mobile, "icon.png");
await out(svg(1024, 1024, centred(1024, 0.72, testCard("f"))), ...mobile, "android-icon-foreground.png");
await out(svg(1024, 1024, `<rect width="1024" height="1024" fill="${BG}"/>`), ...mobile, "android-icon-background.png");
await out(svg(1024, 1024, centred(1024, 0.72, testCardMono())), ...mobile, "android-icon-monochrome.png");
await out(svg(1024, 1024, centred(1024, 0.8, testCard("s"))), ...mobile, "splash-icon.png");
await out(rounded(48), ...mobile, "favicon.png");
await out(banner, ...mobile, "tv-banner.png");

await out(rounded(512), "apps", "desktop", "build", "icon.png");
const icoFile = join(root, "apps", "desktop", "build", "icon.ico");
writeFileSync(icoFile, await ico([16, 24, 32, 48, 64, 128, 256]));
console.log("icons written");
