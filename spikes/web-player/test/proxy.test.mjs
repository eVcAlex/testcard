import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, describe, it } from "node:test";
import proxy, { isPrivateHost, refusal, rewritePlaylist } from "../proxy.mjs";

const env = { SPIKE_TOKEN: "secret", ALLOW_PRIVATE: "1" };
let server;
let origin;

before(async () => {
  server = createServer((req, res) => {
    if (req.url === "/live/u/p/1.m3u8") {
      res.setHeader("content-type", "application/vnd.apple.mpegurl");
      res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6,\nseg/1.ts\n#EXTINF:6,\nhttp://other.example/2.ts\n');
    } else if (req.url === "/old") {
      res.statusCode = 302;
      res.setHeader("location", "/live/u/p/1.m3u8");
      res.end();
    } else if (req.url === "/loop") {
      res.statusCode = 302;
      res.setHeader("location", "/loop");
      res.end();
    } else if (req.url === "/film.mp4") {
      const body = Buffer.from("0123456789");
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? "");
      res.setHeader("content-type", "video/mp4");
      res.setHeader("accept-ranges", "bytes");
      if (range) {
        const end = range[2] ? Number(range[2]) : body.length - 1;
        res.statusCode = 206;
        res.setHeader("content-range", `bytes ${range[1]}-${end}/${body.length}`);
        res.end(body.subarray(Number(range[1]), end + 1));
      } else res.end(body);
    } else {
      res.statusCode = 404;
      res.end("no");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const get = (target, { token = "secret", headers = {}, e = env } = {}) =>
  proxy.fetch(new Request(`https://spike.test/p?u=${encodeURIComponent(target)}&t=${token}`, { headers }), e);

describe("refusals", () => {
  it("knows private hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "[::1]", "fd00::1", "fe80::1", "box.local"])
      assert.equal(isPrivateHost(host), true, host);
    for (const host of ["example.com", "8.8.8.8", "172.32.0.1", "172.15.0.1"]) assert.equal(isPrivateHost(host), false, host);
  });
  it("refuses other schemes and credentials", () => {
    assert.match(refusal(new URL("file:///etc/passwd"), {}), /http/);
    assert.match(refusal(new URL("http://user:pw@example.com/"), {}), /credentials/);
    assert.equal(refusal(new URL("https://example.com/"), {}), null);
  });
  it("needs the token", async () => {
    assert.equal((await get(`${origin}/film.mp4`, { token: "wrong" })).status, 401);
    assert.equal((await get(`${origin}/film.mp4`, { e: {} })).status, 401);
  });
  it("does not fetch private addresses unless the test switch is on", async () => {
    const response = await get(`${origin}/film.mp4`, { e: { SPIKE_TOKEN: "secret" } });
    assert.equal(response.status, 400);
  });
  it("gives up on a redirect loop", async () => {
    const response = await get(`${origin}/loop`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /redirect/);
  });
  it("explains a provider it cannot reach", async () => {
    const response = await get("http://127.0.0.1:1/x");
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "could not reach the provider");
  });
});

describe("playlists", () => {
  it("rewrites segments, keys and absolute addresses to come back through the proxy", () => {
    const out = rewritePlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nseg/1.ts\nhttp://o.example/2.ts', new URL("http://p.example/live/a.m3u8"), "https://spike.test/p", "tok");
    const lines = out.split("\n");
    assert.equal(lines[1], `#EXT-X-MAP:URI="https://spike.test/p?u=${encodeURIComponent("http://p.example/live/init.mp4")}&t=tok"`);
    assert.equal(lines[2], `https://spike.test/p?u=${encodeURIComponent("http://p.example/live/seg/1.ts")}&t=tok`);
    assert.equal(lines[3], `https://spike.test/p?u=${encodeURIComponent("http://o.example/2.ts")}&t=tok`);
  });
  it("serves a rewritten playlist with CORS, following a redirect to it", async () => {
    const response = await get(`${origin}/old`, { headers: { origin: "https://page.test" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://page.test");
    const text = await response.text();
    assert.ok(!text.includes("\nseg/1.ts"));
    assert.ok(text.includes("https://spike.test/p?u="));
  });
});

describe("media", () => {
  it("passes a Range request through", async () => {
    const response = await get(`${origin}/film.mp4`, { headers: { range: "bytes=2-5" } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await response.text(), "2345");
  });
  it("answers a preflight", async () => {
    const response = await proxy.fetch(new Request("https://spike.test/p", { method: "OPTIONS", headers: { origin: "https://page.test" } }), env);
    assert.equal(response.status, 204);
    assert.match(response.headers.get("access-control-allow-headers"), /range/);
  });
});
