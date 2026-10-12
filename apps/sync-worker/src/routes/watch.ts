import type { AppContext } from "../validation.js";

/**
 * The stream proxy behind the web player (`apps/player`). A browser cannot call a provider itself: providers send no CORS
 * headers, and many are plain http, which an https page may not load. So the player asks `GET /watch/p?u=<address>` and this
 * fetches it, follows redirects (checking every hop), passes Range requests through, streams the body without buffering it,
 * and rewrites HLS playlists so each segment and key they name also comes back through here.
 *
 * Only a signed-in account may use it (the session cookie rides along on media elements, which cannot send headers), and it
 * answers 404 unless `WEB_PLAYER` is "on", so deploying it does not switch it on. It never forwards the caller's cookies, and
 * it refuses private networks and this service's own addresses.
 */

const MAX_REDIRECTS = 5;
const MAX_PLAYLIST_BYTES = 2_000_000;
/** How long a provider has to answer with headers; the body that follows may stream for as long as the viewer watches. */
const HEADERS_WITHIN_MS = 20_000;
/** Providers often turn away a client they do not know. */
const UPSTREAM_USER_AGENT = "Testcard-Web";

/** True for names that mean this machine or a private network. A Worker cannot reach those anyway; this is belt and braces. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (host.includes(":")) return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:");
  return false;
}

/** This service's own addresses: fetching them would let a caller loop the proxy through itself. */
const isOurs = (hostname: string) => /(^|\.)(evicted\.dev|workers\.dev)$/i.test(hostname);

/** Why this address may not be fetched, or null when it may. */
export function refusal(url: URL, allowPrivate: boolean): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "only http and https addresses";
  if (url.username !== "" || url.password !== "") return "no credentials in the address";
  if (isOurs(url.hostname)) return "that address is not fetched";
  if (!allowPrivate && isPrivateHost(url.hostname)) return "private addresses are not fetched";
  return null;
}

/** Rewrites a playlist so each address in it (segments, keys, maps, renditions) is fetched through the proxy. */
export function rewritePlaylist(text: string, base: URL, proxyBase: string): string {
  const through = (address: string) => `${proxyBase}?u=${encodeURIComponent(new URL(address, base).href)}`;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (line.trim() === "") return line;
      if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, address: string) => `URI="${through(address)}"`);
      return through(line.trim());
    })
    .join("\n");
}

const isPlaylist = (response: Response, url: URL) => /mpegurl/i.test(response.headers.get("content-type") ?? "") || /\.m3u8?$/i.test(url.pathname);

async function follow(first: URL, headers: Headers, allowPrivate: boolean): Promise<{ response: Response; url: URL } | { refused: string }> {
  let url = first;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const why = refusal(url, allowPrivate);
    if (why !== null) return { refused: why };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEADERS_WITHIN_MS);
    let response: Response;
    try {
      response = await fetch(url, { headers, redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location !== null) {
      await response.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    return { response, url };
  }
  return { refused: "too many redirects" };
}

export async function handleWatchProxy(c: AppContext): Promise<Response> {
  if (c.env.WEB_PLAYER !== "on") return c.json({ error: "not found" }, 404);
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.json({ error: "GET only" }, 405);

  let target: URL;
  try {
    target = new URL(c.req.query("u") ?? "");
  } catch {
    return c.json({ error: "u is not an address" }, 400);
  }

  const forward = new Headers({ "user-agent": UPSTREAM_USER_AGENT });
  const range = c.req.header("range");
  if (range !== undefined) forward.set("range", range);

  let result: Awaited<ReturnType<typeof follow>>;
  try {
    result = await follow(target, forward, c.env.WATCH_ALLOW_PRIVATE === "1");
  } catch (error) {
    // Ports, raw addresses, TLS and DNS failures all end up here; the player shows the words.
    return c.json({ error: "could not reach the provider", detail: error instanceof Error ? error.message : String(error), host: target.host }, 502);
  }
  if ("refused" in result) return c.json({ error: result.refused }, 400);

  const { response, url } = result;
  if (isPlaylist(response, url) && response.ok) {
    const text = await response.text();
    if (text.length > MAX_PLAYLIST_BYTES) return c.json({ error: "playlist too large" }, 502);
    // Relative, so they resolve against whatever address the viewer reached the proxy by.
    return new Response(rewritePlaylist(text, url, "/watch/p"), { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl", "cache-control": "no-store" } });
  }
  const headers = new Headers({ "cache-control": "no-store" });
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // The body is passed on as it arrives; nothing is buffered.
  return new Response(c.req.method === "HEAD" ? null : response.body, { status: response.status, headers });
}
