import { describe, expect, it } from "vitest";
import { describeStreamProbe, probeStream } from "../source/probeStream.js";

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
