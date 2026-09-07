import { app, protocol } from "electron";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Channel logos are served through this custom scheme instead of the renderer loading provider
 * CDN URLs directly from `<img>`: the main process makes the request (no Referer, neutral UA)
 * and caches the bytes under `userData/logo-cache`, so the renderer never reveals the user's IP
 * to hundreds of logo hosts and a second launch renders the grid offline.
 *
 * URL shape: `testcard-logo://logo?u=<encodeURIComponent(originalHttpsUrl)>`.
 * A fetch failure returns 404 so the card's existing initials fallback (`onError`) still fires.
 * No eviction in v1 — logos are tiny and the working set is bounded by the channel count.
 */
const SCHEME = "testcard-logo";

/** Must run before `app.whenReady()` — privileged schemes can't be registered after. */
export function registerLogoScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

let cacheDir = "";
const inflight = new Map<string, Promise<Buffer | null>>();

export function registerLogoProtocol(): void {
  cacheDir = join(app.getPath("userData"), "logo-cache");
  void mkdir(cacheDir, { recursive: true });

  protocol.handle(SCHEME, async (request) => {
    const target = new URL(request.url).searchParams.get("u");
    if (target === null || !/^https?:\/\//i.test(target)) return new Response(null, { status: 400 });

    const bytes = await cachedLogo(target).catch(() => null);
    if (bytes === null) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "content-type": contentTypeFor(target), "cache-control": "public, max-age=604800" },
    });
  });
}

async function cachedLogo(target: string): Promise<Buffer | null> {
  const key = createHash("sha1").update(target).digest("hex");
  const file = join(cacheDir, key);
  if (existsSync(file)) return readFile(file);

  let pending = inflight.get(key);
  if (pending === undefined) {
    pending = (async () => {
      const response = await fetch(target, { headers: { "user-agent": "Testcard" }, redirect: "follow" });
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(file, buffer).catch(() => undefined);
      return buffer;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

function contentTypeFor(url: string): string {
  const ext = new URL(url).pathname.toLowerCase().match(/\.(png|jpe?g|webp|gif|svg)$/)?.[1];
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
}
