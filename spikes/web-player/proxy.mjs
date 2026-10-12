// Spike: a stream proxy for a browser player. NOT production code (see README): the token is one shared secret.
//
//   GET /p?u=<provider url>&t=<token>
//
// Fetches the provider URL for the browser (which cannot, for want of CORS headers and because many providers are plain
// http), follows redirects itself (checking every hop), passes Range requests through, and rewrites HLS playlists so every
// segment and key they name also comes back through here. Anything it cannot fetch is answered with a JSON diagnosis, because
// finding out what the platform refuses (ports, raw IP addresses, redirects) is much of what the spike is for.

const MAX_REDIRECTS = 5;
const MAX_PLAYLIST_BYTES = 2_000_000;

/** True for addresses that name this machine or a private network. A Worker cannot reach those anyway; this is belt and braces. */
export function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (host.includes(":")) return host === "::" || host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:");
  return false;
}

/** Why this address may not be fetched, or null when it may. */
export function refusal(url, env) {
  if (url.protocol !== "http:" && url.protocol !== "https:") return "only http and https addresses";
  if (url.username || url.password) return "no credentials in the address";
  if (env.ALLOW_PRIVATE !== "1" && isPrivateHost(url.hostname)) return "private addresses are not fetched";
  return null;
}

const json = (status, body, cors) => new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json", ...cors } });

function corsFor(request) {
  return {
    "access-control-allow-origin": request.headers.get("origin") ?? "*",
    "access-control-allow-headers": "range, content-type",
    "access-control-expose-headers": "content-length, content-range, content-type, accept-ranges, x-final-url",
    vary: "origin",
  };
}

const looksLikePlaylist = (response, url) => /mpegurl/i.test(response.headers.get("content-type") ?? "") || /\.m3u8?$/i.test(url.pathname);

/** Rewrites a playlist so each address in it (segments, keys, maps, renditions) is fetched through the proxy. */
export function rewritePlaylist(text, base, proxyBase, token) {
  const through = (address) => `${proxyBase}?u=${encodeURIComponent(new URL(address, base).href)}&t=${encodeURIComponent(token)}`;
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (line.trim() === "") return line;
      if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, address) => `URI="${through(address)}"`);
      return through(line.trim());
    })
    .join("\n");
}

async function follow(first, headers, env) {
  let url = first;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const why = refusal(url, env);
    if (why) return { refused: why };
    const response = await fetch(url, { headers, redirect: "manual" });
    if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
      url = new URL(response.headers.get("location"), url);
      continue;
    }
    return { response, url };
  }
  return { refused: "too many redirects" };
}

export default {
  async fetch(request, env) {
    const cors = corsFor(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET" && request.method !== "HEAD") return json(405, { error: "GET only" }, cors);
    const here = new URL(request.url);
    if (here.pathname !== "/p") return json(404, { error: "not found" }, cors);
    if (!env.SPIKE_TOKEN || here.searchParams.get("t") !== env.SPIKE_TOKEN) return json(401, { error: "bad or missing token" }, cors);

    let target;
    try {
      target = new URL(here.searchParams.get("u") ?? "");
    } catch {
      return json(400, { error: "u is not an address" }, cors);
    }

    const forward = new Headers();
    const range = request.headers.get("range");
    if (range) forward.set("range", range);
    forward.set("user-agent", env.UPSTREAM_USER_AGENT ?? "Testcard-spike");

    let result;
    try {
      result = await follow(target, forward, env);
    } catch (error) {
      // What the platform said about reaching the provider: ports, raw IPs, TLS, DNS all end up here.
      return json(502, { error: "could not reach the provider", detail: String(error?.message ?? error), host: target.host }, cors);
    }
    if (result.refused) return json(400, { error: result.refused }, cors);

    const { response, url } = result;
    const headers = new Headers(cors);
    headers.set("x-final-url", `${url.origin}${url.pathname}`);
    if (looksLikePlaylist(response, url) && response.ok) {
      const text = await response.text();
      if (text.length > MAX_PLAYLIST_BYTES) return json(502, { error: "playlist too large" }, cors);
      headers.set("content-type", "application/vnd.apple.mpegurl");
      return new Response(rewritePlaylist(text, url, `${here.origin}/p`, here.searchParams.get("t")), { status: 200, headers });
    }
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("cache-control", "no-store");
    // The body is passed on as it arrives; nothing is buffered.
    return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers });
  },
};
