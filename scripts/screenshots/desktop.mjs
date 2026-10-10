// Screenshots of the desktop app, built from demo content only (see README.md in this folder).
//   pnpm --filter @testcard/desktop build
//   node scripts/screenshots/desktop.mjs [outDir]       (default scripts/screenshots/raw (gitignored), then run compress.mjs)
// Launches the built app with Playwright against a throwaway profile, serves scripts/screenshots/fake-provider.mjs on
// localhost, adds it through the app's own add-source call and captures Live TV (with guide) and Movies at 1600x900.
// The video box in Live TV stays black: the picture is drawn by mpv in its own window, which a page screenshot can't see.
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";
import { startFakeProvider } from "./fake-provider.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, "..", "..", "apps", "desktop");
const out = resolve(process.argv[2] ?? join(here, "raw"));
mkdirSync(out, { recursive: true });
const electronPath = createRequire(join(desktop, "package.json"))("electron");
const profile = mkdtempSync(join(tmpdir(), "testcard-shots-"));

const server = await startFakeProvider(9998);
const app = await _electron.launch({ executablePath: electronPath, args: [desktop, `--user-data-dir=${profile}`], env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "ELECTRON_RUN_AS_NODE")) });
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() =>
    window.testcard.sources.add({ name: "Demo", via: "xtream", baseUrl: "http://127.0.0.1:9998", username: "demo", password: "demo", content: { live: true, movies: true, series: false } }),
  );
  await page.reload();
  const tab = (name) => page.getByRole("button", { name, exact: false }).first();
  for (const [label, file, ready] of [
    ["Live TV", "desktop-live.png", "Open Movies One"],
    ["Movies", "desktop-movies.png", "Sintel"],
  ]) {
    await tab(label).click();
    await page.getByText(ready).first().waitFor({ timeout: 90000 });
    await page.waitForTimeout(3500); // logos and posters load through the main process
    await page.screenshot({ path: join(out, file) });
    console.log("wrote", file);
  }
} finally {
  await app.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
