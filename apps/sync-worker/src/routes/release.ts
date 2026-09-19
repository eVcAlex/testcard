import type { Context } from "hono";
import type { Env } from "../index.js";

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".apk": "application/vnd.android.package-archive",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".yml": "text/yaml",
};

/**
 * Serves the app's own release files (the update manifest and the APKs) from the RELEASES bucket, so
 * a sideloaded app can update itself without a token: the GitHub repo is private. Public by design,
 * read-only, and holds nothing but build output.
 */
export async function handleRelease(c: Context<{ Bindings: Env }>): Promise<Response> {
  const name = c.req.param("file") ?? "";
  const extension = name.slice(name.lastIndexOf("."));
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || CONTENT_TYPES[extension] === undefined) return c.json({ error: "not found" }, 404);
  const object = await c.env.RELEASES.get(name);
  if (object === null) return c.json({ error: "not found" }, 404);
  return new Response(object.body, {
    headers: {
      "content-type": CONTENT_TYPES[extension],
      "content-length": String(object.size),
      etag: object.httpEtag,
      // The manifest must never be served stale; the versioned installers can be cached.
      "cache-control": extension === ".json" || extension === ".yml" ? "no-cache" : "public, max-age=300",
    },
  });
}
