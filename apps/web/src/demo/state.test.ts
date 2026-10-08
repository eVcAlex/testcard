import { CHANNELS, CLOCK_END, CLOCK_START } from "./data.ts";
import { categoryCount, describe as describeChannel, emptyMessage, fmtTime, initialState, nowNext, programmeIndexAt, reducer, upcoming, visibleChannels } from "./state.ts";
import type { DemoAction, DemoState } from "./state.ts";

const run = (s: DemoState, ...actions: DemoAction[]) => actions.reduce(reducer, s);
const ids = (s: DemoState) => visibleChannels(s).map((c) => c.id);

describe("demo data", () => {
  it("has 14 invented channels in 4 categories, two sources, a raw and a tidy name each", () => {
    expect(CHANNELS).toHaveLength(14);
    expect(new Set(CHANNELS.map((c) => c.category)).size).toBe(4);
    expect(new Set(CHANNELS.map((c) => c.source)).size).toBe(2);
    CHANNELS.forEach((c) => expect(c.raw).not.toBe(c.name));
  });
  it("has gapless schedules that cover the clock range", () => {
    for (const c of CHANNELS) {
      expect(c.schedule[0]!.start).toBeLessThanOrEqual(CLOCK_START);
      c.schedule.slice(1).forEach((p, i) => expect(p.start).toBe(c.schedule[i]!.end));
      expect(c.schedule.at(-1)!.end).toBeGreaterThanOrEqual(CLOCK_END + 6 * 60);
    }
  });
});

describe("reducer", () => {
  const s0 = initialState();

  it("starts at 20:58 on Harbour News with two favourites", () => {
    expect(fmtTime(s0.clock)).toBe("20:58");
    expect(s0.focus).toEqual({ channelId: "harbour", slotIndex: 0 });
    expect(s0.favs).toEqual(["peak", "moon"]);
  });

  it("moves focus down and up the visible list and clamps at both ends", () => {
    expect(run(s0, { type: "moveFocus", delta: 1 }).focus.channelId).toBe("tide");
    expect(run(s0, { type: "moveFocus", delta: -1 }).focus.channelId).toBe("harbour");
    expect(run(s0, { type: "focusEdge", edge: "last" }).focus.channelId).toBe("quiet");
    expect(run(s0, { type: "focusEdge", edge: "last" }, { type: "moveFocus", delta: 1 }).focus.channelId).toBe("quiet");
  });

  it("moves the programme column between 0 and 3 and announces it", () => {
    expect(run(s0, { type: "moveSlot", delta: -1 }).focus.slotIndex).toBe(0);
    const s = run(s0, { type: "moveSlot", delta: 1 });
    expect(s.focus.slotIndex).toBe(1);
    expect(s.announce).toMatch(/^Harbour News, \d\d:\d\d, /);
    expect(run(s0, ...Array(9).fill({ type: "moveSlot", delta: 1 })).focus.slotIndex).toBe(3);
  });

  it("filters by category and keeps focus on a listed channel", () => {
    const s = run(s0, { type: "moveFocus", delta: 1 }, { type: "setCategory", category: "sport" });
    expect(ids(s)).toEqual(["peak", "peak2"]);
    expect(s.focus.channelId).toBe("peak");
    expect(s.announce).toBe("Sport: 2 channels");
    expect(categoryCount(s, "all")).toBe(14);
    expect(categoryCount(s, "fav")).toBe(2);
  });

  it("searches names, raw names, categories and programme titles, case-insensitively", () => {
    expect(ids(run(s0, { type: "setQuery", query: "HARBOUR" }))).toContain("harbour");
    expect(ids(run(s0, { type: "setQuery", query: "multi-sub" }))).toEqual(["summit"]);
    expect(ids(run(s0, { type: "setQuery", query: "news" }))).toEqual(expect.arrayContaining(["harbour", "tide", "summit"]));
    expect(ids(run(s0, { type: "setQuery", query: "ridge league" }))).toContain("peak");
  });

  it("has an empty state for a search with no match, and for no favourites", () => {
    const none = run(s0, { type: "setQuery", query: "zzzz" });
    expect(ids(none)).toEqual([]);
    expect(emptyMessage(none)).toBe('No signal on that one. Try "news".');
    expect(none.announce).toBe("No channels match");
    const noFavs = run(s0, { type: "toggleFavourite", channelId: "peak" }, { type: "toggleFavourite", channelId: "moon" }, { type: "setCategory", category: "fav" });
    expect(ids(noFavs)).toEqual([]);
    expect(emptyMessage(noFavs)).toMatch(/No favourites yet/);
  });

  it("toggles favourites without touching the original", () => {
    const s = run(s0, { type: "toggleFavourite", channelId: "harbour" });
    expect(s.favs).toEqual(["peak", "moon", "harbour"]);
    expect(s.announce).toBe("Harbour News added to favourites");
    expect(s0.favs).toEqual(["peak", "moon"]);
    expect(run(s, { type: "toggleFavourite", channelId: "harbour" }).favs).toEqual(["peak", "moon"]);
  });

  it("re-anchors focus when the focused channel stops being a favourite in the Favourites list", () => {
    const s = run(s0, { type: "setCategory", category: "fav" }, { type: "focusEdge", edge: "first" });
    expect(s.focus.channelId).toBe("peak");
    expect(run(s, { type: "toggleFavourite", channelId: "peak" }).focus.channelId).toBe("moon");
  });

  it("plays a channel and announces the selection", () => {
    const s = run(s0, { type: "play", channelId: "peak" });
    expect(s.playing).toBe("peak");
    expect(s.focus.channelId).toBe("peak");
    expect(s.announce).toMatch(/^Selected: Peak Sport, now: .+ until \d\d:\d\d, next: /);
  });

  it("toggles TV mode and raw names", () => {
    expect(run(s0, { type: "toggleTv" }).mode).toBe("tv");
    expect(run(s0, { type: "toggleTv" }, { type: "toggleTv" }).mode).toBe("guide");
    expect(run(s0, { type: "setRaw", value: true }).showRawNames).toBe(true);
    expect(run(s0, { type: "setRaw", value: false })).toBe(s0);
  });

  it("advances the clock a minute per tick and loops from 21:30 back to 20:58", () => {
    expect(fmtTime(run(s0, { type: "tick" }).clock)).toBe("20:59");
    let s = s0;
    for (let i = 0; i < CLOCK_END - CLOCK_START; i++) s = reducer(s, { type: "tick" });
    expect(fmtTime(s.clock)).toBe("21:30");
    expect(fmtTime(reducer(s, { type: "tick" }).clock)).toBe("20:58");
  });
});

describe("selectors", () => {
  const harbour = CHANNELS[0]!;
  it("finds the on-air programme, its progress and the next one", () => {
    const { now, next, elapsed, total } = nowNext(harbour, CLOCK_START);
    expect(now.start).toBeLessThanOrEqual(CLOCK_START);
    expect(now.end).toBeGreaterThan(CLOCK_START);
    expect(next?.start).toBe(now.end);
    expect(elapsed).toBe(CLOCK_START - now.start);
    expect(total).toBe(now.end - now.start);
  });
  it("changes the on-air programme as the clock passes a boundary", () => {
    const before = programmeIndexAt(harbour, 20 * 60 + 59);
    const after = programmeIndexAt(harbour, 22 * 60 + 1);
    expect(after).toBeGreaterThan(before);
  });
  it("lists four programmes from the one on air", () => {
    const u = upcoming(harbour, CLOCK_START);
    expect(u).toHaveLength(4);
    expect(u[0]).toBe(nowNext(harbour, CLOCK_START).now);
  });
  it("describes a channel for its accessible name", () => {
    expect(describeChannel(harbour, CLOCK_START)).toMatch(/^Harbour News, now: .+ until \d\d:\d\d, next: .+/);
  });
  it("formats clock times past midnight", () => {
    expect(fmtTime(25 * 60 + 5)).toBe("01:05");
  });
});
