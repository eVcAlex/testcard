import { describe, expect, it } from "vitest";
import { upNextIn, type EpisodeRow, type SeasonWithEpisodes, type SeriesDetail } from "../db/seriesQueries.js";

const episode = (id: string, n: number, position: number | null): EpisodeRow =>
  ({ id, season_id: "s", series_id: "x", episode_number: n, name: id, container_extension: null, duration_secs: 2400, plot: null, image_url: null, position_secs: position, watched: 0 });
const season = (n: number, episodes: EpisodeRow[]) => ({ id: `s${n}`, series_id: "x", season_number: n, name: null, poster_url: null, episodes }) as unknown as SeasonWithEpisodes;
const detail = { series: {}, seasons: [season(1, [episode("s1e11", 11, 600)]), season(4, [episode("s4e1", 1, 77)])] } as unknown as SeriesDetail;

describe("upNextIn", () => {
  it("resumes the part-watched episode touched last, not the earliest", () => {
    const picked = upNextIn(detail, new Map([["s1e11", 1000], ["s4e1", 2000]]));
    expect(picked?.episode.id).toBe("s4e1");
  });
  it("falls back to the earliest when there are no times", () => {
    expect(upNextIn(detail)?.episode.id).toBe("s1e11");
  });
});
