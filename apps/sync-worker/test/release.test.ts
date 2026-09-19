import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

describe("GET /app/:file", () => {
  beforeAll(async () => {
    await env.RELEASES.put("latest.json", JSON.stringify({ versionCode: 3 }));
    await env.RELEASES.put("testcard-firetv.apk", new Uint8Array([1, 2, 3, 4]));
    await env.RELEASES.put("notes.txt", "not a release type");
  });

  it("serves the manifest uncached, without a session", async () => {
    const response = await SELF.fetch("https://example.com/app/latest.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.json()).toEqual({ versionCode: 3 });
  });

  it("serves an APK with its type and length", async () => {
    const response = await SELF.fetch("https://example.com/app/testcard-firetv.apk");
    expect(response.headers.get("content-type")).toBe("application/vnd.android.package-archive");
    expect(response.headers.get("content-length")).toBe("4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("404s a missing file, an unlisted type and a path trick", async () => {
    expect((await SELF.fetch("https://example.com/app/missing.apk")).status).toBe(404);
    expect((await SELF.fetch("https://example.com/app/notes.txt")).status).toBe(404);
    expect((await SELF.fetch("https://example.com/app/..%2Fsecret.json")).status).toBe(404);
  });
});
