# Web player spike

A throwaway test of one question: **can a browser, especially iPhone Safari, play our providers' streams if a Worker
proxies them?** It is not part of the app, the pnpm workspace or CI, and it deploys as its own Worker
(`testcard-web-spike`), never touching `testcard-sync`, the site or the database.

## What is here

- `proxy.mjs` — the Worker. `GET /p?u=<address>&t=<token>` fetches the provider address, follows redirects (checking every
  hop), passes `Range` through, streams the body, and rewrites HLS playlists so segments and keys come back through it too.
  A failure to reach the provider is answered with a JSON diagnosis, because what Workers refuse (ports, raw IPs) is part of
  what we are testing.
- `public/index.html` — the test page. Lists what this browser can decode, **probes** an address (reachable? what container?),
  **plays** it (native HLS on Safari, otherwise hls.js), counts stalls and time to first picture, and copies a JSON report.
- `test/proxy.test.mjs` — local tests of the proxy logic (`node --test test/proxy.test.mjs`). They cover refusals, redirects,
  playlist rewriting and Range; they do **not** prove anything about browsers or real providers.

## Running it

```sh
cd spikes/web-player
node --test test/proxy.test.mjs          # local checks
npx wrangler secret put SPIKE_TOKEN      # any long random string (create the Worker first with `npx wrangler deploy`)
npx wrangler deploy                      # prints https://testcard-web-spike.<you>.workers.dev
```

Open that address on the iPhone, enter the token and one stream address, press Probe, then Play, and send back the report
(Copy report). Try, per provider: a live channel as `.m3u8`, the same as `.ts`, a film, an episode, and a channel on the
provider's non-standard port (8080, 25461, ...) and one addressed by raw IP if any are.

**Delete the Worker afterwards** (`npx wrangler delete`). Everything it proxies carries your provider login in the address,
and the token is one shared secret, so it is not for anyone else to use.

## What the spike cannot tell us

- Production auth: this uses one shared token, not account sign-in or per-user signed links.
- Cost at scale or Cloudflare's terms for video through Workers: ask Cloudflare. A small test will not trip anything, and it
  is not evidence either way.
- Providers' view of requests coming from Cloudflare addresses rather than a home connection.
- Anything about the SQLite-in-the-browser half (OPFS, import time of ~18k channels on a phone), which is a separate spike.
