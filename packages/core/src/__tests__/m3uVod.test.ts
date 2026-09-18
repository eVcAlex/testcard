import { afterEach, describe, expect, it, vi } from "vitest";
import { createM3UAdapter } from "../source/m3u/adapter.js";
import { classifyEntry, movieKey, seriesKey, urlExtension } from "../source/m3u/classifyEntry.js";

describe("classifyEntry", () => {
  it("keeps ordinary live streams live", () => {
    for (const url of [
      "http://host:8080/live/user/pass/1234.ts",
      "http://host:8080/user/pass/1234",
      "http://host/stream/abc.m3u8?token=1",
      "http://host/play/channel.ts",
    ]) {
      expect(classifyEntry({ rawName: "BBC One", url }).kind).toBe("live");
    }
  });

  it("recognises Xtream-style movie paths", () => {
    expect(classifyEntry({ rawName: "Dune (2021)", url: "http://host/movie/user/pass/555.mkv" })).toEqual({
      kind: "movie",
      title: "Dune (2021)",
      extension: "mkv",
    });
  });

  it("recognises a video file even without a movie path", () => {
    expect(classifyEntry({ rawName: "Heat 1995", url: "http://cdn.example/files/heat.mp4?sig=abc" }).kind).toBe("movie");
    expect(classifyEntry({ rawName: "Old Film", url: "http://cdn.example/old.avi" }).kind).toBe("movie");
  });

  it("does not treat a /live/ path as a film even with a video extension", () => {
    expect(classifyEntry({ rawName: "Movie Channel", url: "http://host/live/u/p/9.mp4" }).kind).toBe("live");
  });

  it("splits an episode into show, season, episode and title", () => {
    expect(classifyEntry({ rawName: "Breaking Bad S01E02 Cat's in the Bag...", url: "http://host/series/u/p/77.mkv" })).toEqual({
      kind: "episode",
      series: "Breaking Bad",
      season: 1,
      episode: 2,
      title: "Cat's in the Bag...",
      extension: "mkv",
    });
  });

  it("reads the common episode spellings", () => {
    const parse = (rawName: string) => classifyEntry({ rawName, url: "http://host/x/y.mp4" });
    expect(parse("The Office - S03E10 - Business School")).toMatchObject({ series: "The Office", season: 3, episode: 10, title: "Business School" });
    expect(parse("The.Wire.s02.e05.mkv")).toMatchObject({ series: "The Wire", season: 2, episode: 5 });
    expect(parse("Friends 4x08 The One with the Jellyfish")).toMatchObject({ series: "Friends", season: 4, episode: 8 });
    expect(parse("Show S01E01E02")).toMatchObject({ series: "Show", season: 1, episode: 1 });
  });

  it("falls back to a film when a /series/ entry has no readable episode marker", () => {
    expect(classifyEntry({ rawName: "Some Special", url: "http://host/series/u/p/1.mp4" }).kind).toBe("movie");
  });

  it("needs a show title, not just a marker", () => {
    expect(classifyEntry({ rawName: "S01E01", url: "http://host/x/y.mp4" }).kind).toBe("movie");
  });

  it("reads the extension from the path, not the query", () => {
    expect(urlExtension("http://h/a/b.MKV?x=1.mp4")).toBe("mkv");
    expect(urlExtension("http://h/a/b")).toBeNull();
  });

  it("builds keys that ignore case, punctuation and a series year", () => {
    expect(seriesKey("Doctor Who (2005)")).toBe(seriesKey("doctor who"));
    expect(movieKey("Dune (1984)")).not.toBe(movieKey("Dune (2021)"));
  });

  it("is deterministic", () => {
    const entry = { rawName: "Show S02E03 Title", url: "http://h/series/u/p/2.mkv" };
    expect(classifyEntry(entry)).toEqual(classifyEntry(entry));
  });
});

const PLAYLIST = [
  "#EXTM3U",
  '#EXTINF:-1 tvg-id="bbc1" tvg-logo="http://l/bbc.png" group-title="UK| TV",BBC One',
  "http://host/live/u/p/1.ts",
  '#EXTINF:-1 tvg-logo="http://l/dune.jpg" group-title="Movies",Dune (2021)',
  "http://host/movie/u/p/10.mkv",
  '#EXTINF:-1 group-title="Movies",Heat (1995)',
  "http://host/movie/u/p/11.mp4",
  '#EXTINF:-1 tvg-logo="http://l/bb.jpg" group-title="Drama",Breaking Bad S01E01 Pilot',
  "http://host/series/u/p/20.mkv",
  '#EXTINF:-1 group-title="Drama",Breaking Bad S01E02',
  "http://host/series/u/p/21.mkv",
  '#EXTINF:-1 group-title="UK| TV",Channel 4',
  "http://host/live/u/p/2.ts",
].join("\n");

afterEach(() => vi.unstubAllGlobals());

describe("M3U adapter split", () => {
  it("returns live channels, films and episodes from a single fetch", async () => {
    const fetchMock = vi.fn(async () => new Response(PLAYLIST));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = createM3UAdapter();
    const source = { id: "s1", kind: "m3u", name: "Test", playlistUrl: "http://host/list.m3u" } as const;

    const playlist = await adapter.loadPlaylist(source);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const liveNames = playlist.livePages.flatMap((page) => page.channels.map((channel) => channel.rawName));
    expect(liveNames.sort()).toEqual(["BBC One", "Channel 4"]);
    expect(playlist.livePages.map((page) => page.category.rawName)).toEqual(["UK| TV"]); // no empty Movies/Drama live groups
    expect(playlist.vod.movies.map((movie) => movie.title)).toEqual(["Dune (2021)", "Heat (1995)"]);
    expect(playlist.vod.movies[0]).toMatchObject({ group: "Movies", extension: "mkv", posterUrl: "http://l/dune.jpg", url: "http://host/movie/u/p/10.mkv" });
    expect(playlist.vod.episodes.map((episode) => [episode.series, episode.season, episode.episode])).toEqual([
      ["Breaking Bad", 1, 1],
      ["Breaking Bad", 1, 2],
    ]);
  });

  it("imports only live entries through importAll", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(PLAYLIST)));
    const adapter = createM3UAdapter();
    const pages = [];
    for await (const page of adapter.importAll({ id: "s1", kind: "m3u", name: "Test", playlistUrl: "http://host/list.m3u" })) pages.push(page);
    expect(pages.flatMap((page) => page.channels)).toHaveLength(2);
  });
});
