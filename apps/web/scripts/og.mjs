// Generates public/og.png (1200x630): colour-bar strip, ruled test-card circle, wordmark. Run: pnpm --filter @testcard/web og
// Text is drawn with the system "Plus Jakarta Sans" (falls back to Inter) (librsvg via sharp); install Inter before regenerating. The PNG is committed.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const out = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "public/og.png");
const W = 1200, H = 630;
const bg = "#11100d", fg = "#cfc5ab", muted = "#8f8772", sand = "#e7d2ad", line = "#2e2b22";
const bars = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];

// Ruled circle on the right: concentric rings, a square grid clipped to the circle, centre cross.
const cx = 900, cy = 300, r = 220;
const grid = [];
for (let i = -r; i <= r; i += 44) {
  grid.push(`<line x1="${cx + i}" y1="${cy - r}" x2="${cx + i}" y2="${cy + r}"/>`, `<line x1="${cx - r}" y1="${cy + i}" x2="${cx + r}" y2="${cy + i}"/>`);
}
const barW = W / 7;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <defs><clipPath id="c"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
  <g clip-path="url(#c)" stroke="${line}" stroke-width="2">${grid.join("")}</g>
  <g fill="none" stroke="${muted}" stroke-width="2">
    <circle cx="${cx}" cy="${cy}" r="${r}" stroke-width="4"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.62}" stroke="${line}" stroke-width="3"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.24}" stroke="${sand}" stroke-width="3"/>
  </g>
  <g stroke="${sand}" stroke-width="3"><line x1="${cx - 36}" y1="${cy}" x2="${cx + 36}" y2="${cy}"/><line x1="${cx}" y1="${cy - 36}" x2="${cx}" y2="${cy + 36}"/></g>
  <text x="72" y="268" font-family="Plus Jakarta Sans, Inter, sans-serif" font-weight="600" font-size="112" letter-spacing="-3" fill="${fg}">test<tspan fill="${sand}">card</tspan></text>
  <text x="76" y="352" font-family="Plus Jakarta Sans, Inter, sans-serif" font-weight="500" font-size="44" letter-spacing="-0.5" fill="${fg}">IPTV player</text>
  <text x="76" y="412" font-family="Plus Jakarta Sans, Inter, sans-serif" font-weight="400" font-size="30" fill="${muted}">for Windows and Fire TV, by Evicted</text>
  ${bars.map((c, i) => `<rect x="${i * barW}" y="${H - 72}" width="${barW + 1}" height="72" fill="${c}"/>`).join("")}
</svg>`;

await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(out);
console.log(`wrote ${out}`);
