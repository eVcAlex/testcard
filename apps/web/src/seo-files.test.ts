import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROUTES, buildSitemap } from "./routes-meta.ts";

const pub = (f: string) => readFileSync(resolve(__dirname, "../public", f), "utf8");

it("robots points at the sitemap, which is generated at build rather than committed", () => {
  expect(pub("robots.txt")).toContain("Sitemap: https://evicted.dev/sitemap.xml");
  expect(existsSync(resolve(__dirname, "../public/sitemap.xml"))).toBe(false);
});

it("the sitemap lists every indexable route with a lastmod, and not /link, /terms or the 404", () => {
  const map = buildSitemap("2026-01-31");
  for (const r of ROUTES.filter((r) => !r.noindex)) expect(map).toContain(`<loc>https://evicted.dev${r.path === "/" ? "/" : r.path}</loc><lastmod>2026-01-31</lastmod>`);
  expect(map).toContain("https://evicted.dev/privacy");
  expect(map).not.toContain("/link");
  expect(map).not.toContain("/terms");
  expect(map).not.toContain("404");
});

it("ships the OG image, the theme bootstrap and the subset font", () => {
  for (const f of ["og.png", "theme-init.js", "fonts/InterVariable-latin.woff2", "fonts/OFL.txt"]) expect(existsSync(resolve(__dirname, "../public", f))).toBe(true);
});

it("_headers carries the security set and keeps Cache-Control off the catch-all rule", () => {
  const headers = pub("_headers");
  for (const h of ["Strict-Transport-Security", "Permissions-Policy", "Cross-Origin-Opener-Policy", "Cross-Origin-Resource-Policy", "upgrade-insecure-requests", "script-src 'self'; style-src 'self'"]) expect(headers).toContain(h);
  expect(headers.split(/^\S/m)[1]).not.toContain("Cache-Control");
  expect(headers).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  expect(headers).toMatch(/\/link\n\s+Cache-Control: no-store/);
});

it("keeps the style fixes that QA found: the TV-frame button out-ranks .button.ghost, and prefers-contrast beats the light theme tokens", () => {
  const css = (f: string) => readFileSync(resolve(__dirname, f), "utf8");
  expect(css("home/home.css")).toMatch(/\.hm-fb \.button\.hm-fb-btn \{[^}]*color: var\(--tv-fg\)/);
  expect(css("styles.css")).toMatch(/prefers-contrast: more\) \{[^}]*:root\[data-theme\]/);
});
