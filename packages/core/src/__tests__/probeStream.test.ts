import { describe, expect, it } from "vitest";
import { applyStreamRoute, describeRelayedStream, describeStreamProbe, probeStream, streamRoutes } from "../source/probeStream.js";

const streaming = (chunk: number) =>
  (async () => new Response(new ReadableStream({ start: (c) => c.enqueue(new Uint8Array(chunk).fill(0x47)) }), { status: 200, headers: { "content-type": "video/mp2t" } })) as unknown as typeof fetch;

describe("probeStream", () => {
  it("sees a stream that sends data", async () => {
    expect(await probeStream("http://p.test/live/u/p/1.ts", { fetchImpl: streaming(188) })).toEqual({ kind: "data", status: 200, bytes: 188, contentType: "video/mp2t" });
  });

  it("reports a refusal with the provider's status", async () => {
    const f = (async () => new Response("no", { status: 403 })) as typeof fetch;
    expect(await probeStream("http://p.test/x", { fetchImpl: f })).toEqual({ kind: "refused", status: 403 });
  });

  it("reports a stream that answers but sends nothing", async () => {
    const f = (async () => new Response(new ReadableStream({ start: (c) => c.close() }), { status: 200 })) as typeof fetch;
    expect(await probeStream("http://p.test/x", { fetchImpl: f })).toMatchObject({ kind: "silent", status: 200 });
  });

  it("reports a connection that never answers, and one that is cut", async () => {
    const hang = ((_u: string, init: RequestInit) => new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    expect(await probeStream("http://p.test/x", { fetchImpl: hang, responseMs: 20 })).toEqual({ kind: "unreachable", reason: "timeout" });
    const cut = (async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }))) as typeof fetch;
    expect(await probeStream("http://p.test/x", { fetchImpl: cut })).toEqual({ kind: "unreachable", reason: "reset" });
    const dns = (async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }))) as typeof fetch;
    expect(await probeStream("http://p.test/x", { fetchImpl: dns })).toEqual({ kind: "unreachable", reason: "dns" });
  });
});

describe("describeStreamProbe", () => {
  it("says what each outcome means, and never includes an address", () => {
    expect(describeStreamProbe({ kind: "data", status: 200, bytes: 188, contentType: null })).toContain("built-in player");
    expect(describeStreamProbe({ kind: "refused", status: 403 }, "TREX")).toContain("TREX refused the stream (HTTP 403)");
    expect(describeStreamProbe({ kind: "refused", status: 404 })).toContain("HTTP 404");
    expect(describeStreamProbe({ kind: "unreachable", reason: "reset" })).toContain("ISP block");
    expect(describeStreamProbe({ kind: "unreachable", reason: "timeout" })).toContain("did not answer");
    for (const probe of [{ kind: "silent", status: 200 }, { kind: "unreachable", reason: "dns" }] as const) {
      expect(describeStreamProbe(probe)).not.toMatch(/https?:\/\//);
    }
  });
});

describe("streamRoutes", () => {
  it("offers HLS and https for a plain-http live .ts address, in order", () => {
    expect(streamRoutes("http://p.test/live/u/pw/42.ts")).toEqual([
      { route: "m3u8", url: "http://p.test/live/u/pw/42.m3u8" },
      { route: "https", url: "https://p.test/live/u/pw/42.ts" },
      { route: "https-m3u8", url: "https://p.test/live/u/pw/42.m3u8" },
    ]);
  });

  it("only offers what differs and what is safe to guess", () => {
    expect(streamRoutes("https://p.test/live/u/pw/42.ts").map((r) => r.route)).toEqual(["m3u8"]);
    expect(streamRoutes("http://p.test:8080/live/u/pw/42.ts").map((r) => r.route)).toEqual(["m3u8"]);
    expect(streamRoutes("http://p.test/movie/u/pw/42.mkv").map((r) => r.route)).toEqual(["https"]);
    expect(streamRoutes("not a url")).toEqual([]);
  });

  it("applies one route to an address", () => {
    expect(applyStreamRoute("http://p.test/live/u/pw/42.ts", "https-m3u8")).toBe("https://p.test/live/u/pw/42.m3u8");
    expect(applyStreamRoute("http://p.test/live/u/pw/42.m3u8", "m3u8")).toBe("http://p.test/live/u/pw/42.m3u8");
  });
});

describe("describeRelayedStream", () => {
  it("says the Worker could get through when the provider started sending video", () => {
    expect(describeRelayedStream(415, "that is a video or audio stream, not a list", "TREX")).toContain("TREX accepted the connection and started sending video");
    expect(describeRelayedStream(200, null)).toContain("answered normally");
  });

  it("says when the provider refuses the Worker too", () => {
    expect(describeRelayedStream(403, null, "TREX")).toContain("also refused (HTTP 403)");
    expect(describeRelayedStream(511, null)).toContain("would not get past it");
    expect(describeRelayedStream(502, "could not reach the provider")).toContain("could not be reached either");
  });

  it("stays silent when the relay itself could not be used", () => {
    expect(describeRelayedStream(401, "unauthorized")).toBeNull();
    expect(describeRelayedStream(404, "not found")).toBeNull();
    expect(describeRelayedStream(429, "daily limit reached")).toBeNull();
  });
});
