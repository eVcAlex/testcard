// Runs after `vite build` (client) and `vite build --ssr` (dist-ssr). Renders every static route into the
// client's index.html template, writes dist/404.html and dist/sitemap.xml.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(web, "dist");
const { render, ROUTES, buildSitemap } = await import(pathToFileURL(join(web, "dist-ssr/entry-server.js")).href);

const template = await readFile(join(dist, "index.html"), "utf8");
if (!template.includes("<!--app-head-->") || !template.includes("<!--app-html-->")) {
  throw new Error("dist/index.html is missing the <!--app-head--> / <!--app-html--> placeholders (was it already prerendered?)");
}

const page = ({ html, head }) => template.replace("<!--app-head-->", () => head).replace("<!--app-html-->", () => html);

for (const route of ROUTES) {
  const { html, head, status } = await render(route.path);
  if (status !== 200) throw new Error(`${route.path} rendered as ${status}`);
  const out = route.path === "/" ? join(dist, "index.html") : join(dist, route.path, "index.html");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, page({ html, head }));
}

// Any unknown path renders the "No signal" page; the Worker serves it with a 404 status (not_found_handling "404-page").
const missing = await render("/404-not-found");
if (missing.status !== 404) throw new Error("the unknown-path render did not produce a 404");
await writeFile(join(dist, "404.html"), page(missing));

const lastmod = (() => {
  try {
    const iso = execFileSync("git", ["log", "-1", "--format=%cs", "--", "src", "public"], { cwd: web, encoding: "utf8" }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  } catch {}
  return new Date().toISOString().slice(0, 10);
})();
await writeFile(join(dist, "sitemap.xml"), buildSitemap(lastmod));

await rm(join(web, "dist-ssr"), { recursive: true, force: true });
console.log(`prerendered ${ROUTES.length} routes + 404.html + sitemap.xml (lastmod ${lastmod})`);
