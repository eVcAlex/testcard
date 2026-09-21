import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTimeshiftUrl, fetchCatchupProgrammes, programmeMinutes, splitCatchup, timeshiftStamp, type CatchupProgramme } from "../source/xtream/catchup.js";
import type { Source } from "../source/types.js";

const source: Source = { id: "src1", kind: "xtream", name: "Test", baseUrl: "http://example.com" };
const getCredentials = async () => ({ baseUrl: "http://example.com", username: "user", password: "pass" });

const at = (iso: string) => new Date(iso);
const programme = (title: string, start: string, end: string, archived = true): CatchupProgramme => ({
  title,
  start: at(start),
  end: at(end),
  // The provider's own clock is an hour ahead of UTC in these tests.
  serverStart: `${start.slice(0, 10)} ${String(Number(start.slice(11, 13)) + 1).padStart(2, "0")}:${start.slice(14, 16)}:00`,
  archived,
});

afterEach(() => vi.unstubAllGlobals());

describe("timeshiftStamp", () => {
  it("writes the provider's clock the way a timeshift address wants it", () => {
    expect(timeshiftStamp("2026-09-21 06:30:00")).toBe("2026-09-21:06-30");
  });
  it("gives up on a time in another shape", () => {
    expect(timeshiftStamp("yesterday")).toBeUndefined();
  });
});

describe("programmeMinutes", () => {
  it("rounds to whole minutes and never asks for none", () => {
    expect(programmeMinutes({ start: at("2026-09-21T05:30:00Z"), end: at("2026-09-21T06:00:00Z") })).toBe(30);
    expect(programmeMinutes({ start: at("2026-09-21T05:30:00Z"), end: at("2026-09-21T05:30:10Z") })).toBe(1);
  });
});

describe("splitCatchup", () => {
  const news = programme("News", "2026-09-21T07:00:00Z", "2026-09-21T08:00:00Z");
  const film = programme("Film", "2026-09-21T08:00:00Z", "2026-09-21T10:00:00Z");
  const last = programme("Quiz", "2026-09-21T10:00:00Z", "2026-09-21T11:00:00Z");
  const old = programme("Old", "2026-09-16T10:00:00Z", "2026-09-16T11:00:00Z");
  const gone = programme("Gone", "2026-09-21T06:00:00Z", "2026-09-21T07:00:00Z", false);

  it("finds what is on now and lists what is over, newest first", () => {
    const { current, past } = splitCatchup([news, film, last], at("2026-09-21T10:30:00Z"), 3);
    expect(current?.title).toBe("Quiz");
    expect(past.map((p) => p.title)).toEqual(["Film", "News"]);
  });

  it("leaves out anything the provider no longer has, or that is older than the archive keeps", () => {
    const { past } = splitCatchup([old, gone, news], at("2026-09-21T10:30:00Z"), 3);
    expect(past.map((p) => p.title)).toEqual(["News"]);
  });

  it("has no current programme between listings", () => {
    expect(splitCatchup([news], at("2026-09-21T09:00:00Z"), 3).current).toBeUndefined();
  });
});

describe("fetchCatchupProgrammes", () => {
  it("reads the provider's table, oldest first, decoding titles and dropping unusable rows", async () => {
    const title = (text: string) => Buffer.from(text).toString("base64");
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({
        epg_listings: [
          { title: title("Second"), start: "2026-09-21 07:00:00", start_timestamp: "1790000000", stop_timestamp: "1790003600", has_archive: 1 },
          { title: title("First"), start: "2026-09-21 06:00:00", start_timestamp: "1789996400", stop_timestamp: "1790000000", has_archive: "0" },
          { title: title("No clock"), start_timestamp: "1", stop_timestamp: "2", has_archive: 1 },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const programmes = await fetchCatchupProgrammes(source, "42", getCredentials);
    expect(programmes.map((p) => [p.title, p.archived])).toEqual([
      ["First", false],
      ["Second", true],
    ]);
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.searchParams.get("action")).toBe("get_simple_data_table");
    expect(requested.searchParams.get("stream_id")).toBe("42");
  });

  it("returns nothing when the provider refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    expect(await fetchCatchupProgrammes(source, "42", getCredentials)).toEqual([]);
  });
});

describe("buildTimeshiftUrl", () => {
  it("builds the address from the provider's clock and the programme's length", async () => {
    const url = await buildTimeshiftUrl(source, "42", programme("News", "2026-09-21T05:30:00Z", "2026-09-21T06:00:00Z"), getCredentials);
    expect(url).toBe("http://example.com/timeshift/user/pass/30/2026-09-21:06-30/42.ts");
  });
});
