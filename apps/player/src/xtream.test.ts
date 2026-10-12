import { describe, expect, it } from "vitest";
import { apiUrl, baseOf, episodeUrl, liveUrls, movieUrl, nowAndNext, toCategories, toEpisodes, toLive, toShortEpg } from "./xtream.ts";

const login = { host: "provider.example:8080/", username: "a b", password: "p/w" };

describe("addresses", () => {
  it("defaults the scheme and drops trailing slashes", () => {
    expect(baseOf("provider.example:8080/")).toBe("http://provider.example:8080");
    expect(baseOf("https://p.example//")).toBe("https://p.example");
  });
  it("builds the API address with the login as query parameters", () => {
    const url = new URL(apiUrl(login, "get_live_streams", { category_id: "7" }));
    expect(url.origin + url.pathname).toBe("http://provider.example:8080/player_api.php");
    expect(Object.fromEntries(url.searchParams)).toEqual({ username: "a b", password: "p/w", action: "get_live_streams", category_id: "7" });
  });
  it("offers HLS before the raw stream, and escapes the login in paths", () => {
    expect(liveUrls(login, 12)).toEqual(["http://provider.example:8080/live/a%20b/p%2Fw/12.m3u8", "http://provider.example:8080/live/a%20b/p%2Fw/12.ts"]);
    expect(movieUrl(login, 5, "mkv")).toBe("http://provider.example:8080/movie/a%20b/p%2Fw/5.mkv");
    expect(movieUrl(login, 5)).toMatch(/5\.mp4$/);
    expect(episodeUrl(login, "9", "mp4")).toBe("http://provider.example:8080/series/a%20b/p%2Fw/9.mp4");
  });
});

describe("provider answers", () => {
  it("reads categories and streams, ignoring rows without an id or a name", () => {
    expect(toCategories([{ category_id: "1", category_name: "UK" }, { category_id: 2 }, "x"])).toEqual([{ id: "1", name: "UK" }]);
    expect(toLive([{ stream_id: 10, name: "BBC One", category_id: "1", stream_icon: "" }, { name: "no id" }])).toEqual([{ id: "10", name: "BBC One", categoryId: "1", logo: undefined }]);
    expect(toLive("nonsense")).toEqual([]);
  });
  it("flattens a series' episodes in season and episode order", () => {
    const info = { episodes: { "2": [{ id: "21", episode_num: 1, title: "S2E1", season: 2 }], "1": [{ id: "12", episode_num: 2, title: "B", season: 1, container_extension: "mkv" }, { id: "11", episode_num: 1, title: "A", season: 1 }] } };
    expect(toEpisodes(info).map((e) => e.id)).toEqual(["11", "12", "21"]);
    expect(toEpisodes(info)[1]?.extension).toBe("mkv");
    expect(toEpisodes(null)).toEqual([]);
  });
});

describe("short guide", () => {
  const b64 = (text: string) => btoa(text);
  const info = { epg_listings: [
    { title: b64("News"), start_timestamp: "1000", stop_timestamp: "2000" },
    { title: b64("Film"), start_timestamp: "2000", stop_timestamp: "5000" },
    { title: "", start_timestamp: "1", stop_timestamp: "2" },
  ] };
  it("reads titles and times, in start order", () => {
    expect(toShortEpg(info).map((p) => [p.title, p.start, p.end])).toEqual([["News", 1_000_000, 2_000_000], ["Film", 2_000_000, 5_000_000]]);
    expect(toShortEpg(null)).toEqual([]);
  });
  it("says what is on and what follows", () => {
    const list = toShortEpg(info);
    expect(nowAndNext(list, 1_500_000)).toMatchObject({ now: { title: "News" }, next: { title: "Film" } });
    expect(nowAndNext(list, 4_000_000)).toMatchObject({ now: { title: "Film" } });
    expect(nowAndNext(list, 4_000_000).next).toBeUndefined();
  });
});
