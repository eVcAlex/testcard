// Serves dist/ on http://localhost:4173 the way Vercel will: clean URLs (/terms -> terms.html) and
// 404.html for anything else. Run `pnpm --filter @testcard/website build` first.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT) || 4173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

if (!existsSync(dist)) {
  console.error("preview: dist/ not found. Run the build first.");
  process.exit(1);
}

const isFile = (p) => existsSync(p) && statSync(p).isFile();

function resolve(urlPath) {
  let path = normalize(decodeURIComponent(urlPath));
  if (path.endsWith(sep) || path === "/") path = join(path, "index.html");
  const candidates = [join(dist, path)];
  if (!extname(path)) candidates.push(join(dist, `${path}.html`));
  return candidates.find((p) => p.startsWith(dist) && isFile(p));
}

createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  let file;
  try {
    file = resolve(pathname);
  } catch {
    file = undefined;
  }
  const status = file ? 200 : 404;
  file ??= join(dist, "404.html");
  res.writeHead(status, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
  res.end(req.method === "HEAD" ? undefined : readFileSync(file));
}).listen(port, () => console.log(`preview on http://localhost:${port}`));
