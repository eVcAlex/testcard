import { describe, expect, it } from "vitest";
import { mapMovieDto, mapSeriesDetailsDto, mapSeriesDto } from "../source/xtream/vod.js";
import type { Category, Series, Source } from "../source/types.js";

const source: Source = { id: "src1", kind: "xtream", name: "Test", baseUrl: "http://example.com" };
const movieCategory: Category = { id: "src1:10", sourceId: "src1", providerId: "10", rawName: "Action" };
const seriesCategory: Category = { id: "src1:20", sourceId: "src1", providerId: "20", rawName: "Drama" };

describe("mapMovieDto", () => {
  it("maps a get_vod_streams entry to a Movie", () => {
    const movie = mapMovieDto(
      { stream_id: 501, name: "Test Movie", category_id: "10", stream_icon: "http://x/poster.jpg", container_extension: "mkv", rating: "7.5" },
      source,
      movieCategory,
    );
    expect(movie).toEqual({
      id: "src1:501",
      sourceId: "src1",
      categoryId: "src1:10",
      providerStreamId: "501",
      name: "Test Movie",
      posterUrl: "http://x/poster.jpg",
      containerExtension: "mkv",
      rating: "7.5",
    });
  });

  it("omits optional fields the provider left blank", () => {
    const movie = mapMovieDto({ stream_id: 502, name: "Bare Movie", category_id: "10" }, source, movieCategory);
    expect(movie).toEqual({
      id: "src1:502",
      sourceId: "src1",
      categoryId: "src1:10",
      providerStreamId: "502",
      name: "Bare Movie",
    });
  });
});

describe("mapSeriesDto", () => {
  it("maps a get_series entry to a Series, including its cheap plot", () => {
    const series = mapSeriesDto(
      { series_id: 900, name: "Test Show", category_id: "20", cover: "http://x/cover.jpg", plot: "A show.", rating: "9" },
      source,
      seriesCategory,
    );
    expect(series).toEqual({
      id: "src1:900",
      sourceId: "src1",
      categoryId: "src1:20",
      providerSeriesId: "900",
      name: "Test Show",
      posterUrl: "http://x/cover.jpg",
      rating: "9",
      plot: "A show.",
    });
  });
});

describe("mapSeriesDetailsDto", () => {
  const series: Series = { id: "src1:900", sourceId: "src1", categoryId: "src1:20", providerSeriesId: "900", name: "Test Show" };

  it("maps get_series_info seasons and episodes, keyed by season number", () => {
    const { seasons, episodes } = mapSeriesDetailsDto(
      {
        seasons: [{ season_number: 1, name: "Season 1", cover: "http://x/s1.jpg" }],
        episodes: {
          "1": [
            { id: 1001, episode_num: 1, title: "Pilot", container_extension: "mp4", season: 1, info: { duration_secs: 1500, plot: "The pilot." } },
            { id: 1002, episode_num: 2, title: "Episode 2", season: 1 },
          ],
        },
      },
      series,
    );

    expect(seasons).toEqual([{ id: "src1:900:1", seriesId: "src1:900", seasonNumber: 1, name: "Season 1", posterUrl: "http://x/s1.jpg" }]);
    expect(episodes).toEqual([
      {
        id: "src1:900:1:1001",
        seasonId: "src1:900:1",
        seriesId: "src1:900",
        providerEpisodeId: "1001",
        episodeNumber: 1,
        name: "Pilot",
        containerExtension: "mp4",
        durationSecs: 1500,
        plot: "The pilot.",
      },
      {
        id: "src1:900:1:1002",
        seasonId: "src1:900:1",
        seriesId: "src1:900",
        providerEpisodeId: "1002",
        episodeNumber: 2,
        name: "Episode 2",
      },
    ]);
  });

  it("synthesizes a season for episodes whose season number is absent from `seasons` (e.g. specials)", () => {
    const { seasons, episodes } = mapSeriesDetailsDto(
      {
        seasons: [{ season_number: 1, name: "Season 1" }],
        episodes: {
          "0": [{ id: 2001, episode_num: 1, title: "Behind the scenes", season: 0 }],
          "1": [{ id: 1001, episode_num: 1, title: "Pilot", season: 1 }],
        },
      },
      series,
    );

    expect(seasons).toEqual([
      { id: "src1:900:1", seriesId: "src1:900", seasonNumber: 1, name: "Season 1" },
      { id: "src1:900:0", seriesId: "src1:900", seasonNumber: 0 },
    ]);
    // Every episode's seasonId must match a season that was actually returned — the DB FK on
    // episodes.season_id requires it.
    const seasonIds = new Set(seasons.map((s) => s.id));
    for (const episode of episodes) expect(seasonIds.has(episode.seasonId)).toBe(true);
  });
});
