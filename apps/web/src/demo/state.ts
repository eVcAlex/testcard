import { CHANNELS, CLOCK_END, CLOCK_START, INITIAL_CHANNEL, INITIAL_FAVOURITES, SLOT_COUNT, categoryLabel, channelById } from "./data.ts";
import type { CategoryId, Channel, Programme } from "./data.ts";

export interface DemoState {
  mode: "guide" | "tv";
  category: CategoryId;
  query: string;
  /** The roving focus: which channel row is the tab stop, and which programme column (0 = now) is highlighted. */
  focus: { channelId: string; slotIndex: number };
  playing: string;
  favs: readonly string[];
  /** Minutes since midnight. Only the clock tick changes it; nothing reads the real time. */
  clock: number;
  showRawNames: boolean;
  /** Text for the polite live region. */
  announce: string;
}

export type DemoAction =
  | { type: "setCategory"; category: CategoryId }
  | { type: "setQuery"; query: string }
  | { type: "moveFocus"; delta: number }
  | { type: "focusEdge"; edge: "first" | "last" }
  | { type: "moveSlot"; delta: number }
  | { type: "play"; channelId: string }
  | { type: "toggleFavourite"; channelId: string }
  | { type: "toggleTv" }
  | { type: "setRaw"; value: boolean }
  | { type: "tick" };

export const fmtTime = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export const initialState = (opts: { showRawNames?: boolean } = {}): DemoState => ({
  mode: "guide",
  category: "all",
  query: "",
  focus: { channelId: INITIAL_CHANNEL, slotIndex: 0 },
  playing: INITIAL_CHANNEL,
  favs: INITIAL_FAVOURITES,
  clock: CLOCK_START,
  showRawNames: opts.showRawNames ?? false,
  announce: "",
});

/* ---------- selectors ---------- */

export const displayName = (c: Channel, raw: boolean) => (raw ? c.raw : c.name);

export function visibleChannels(s: Pick<DemoState, "category" | "query" | "favs" | "clock">): Channel[] {
  const q = s.query.trim().toLowerCase();
  return CHANNELS.filter((c) => {
    if (s.category === "fav" ? !s.favs.includes(c.id) : s.category !== "all" && c.category !== s.category) return false;
    if (!q) return true;
    const hay = `${c.name} ${c.raw} ${categoryLabel(c.category)} ${upcoming(c, s.clock).map((p) => p?.title).join(" ")}`.toLowerCase();
    return hay.includes(q);
  });
}

/** Index into channel.schedule of the programme on air at `minute` (the last one if the schedule has ended). */
export function programmeIndexAt(c: Channel, minute: number): number {
  const i = c.schedule.findIndex((p) => minute >= p.start && minute < p.end);
  return i < 0 ? c.schedule.length - 1 : i;
}

export interface NowNext { now: Programme; next: Programme | undefined; elapsed: number; total: number }
export function nowNext(c: Channel, clock: number): NowNext {
  const i = programmeIndexAt(c, clock);
  const now = c.schedule[i]!;
  return { now, next: c.schedule[i + 1], elapsed: Math.max(0, Math.min(now.end - now.start, clock - now.start)), total: now.end - now.start };
}

/** The on-air programme and the ones after it, for the wide guide's columns. */
export function upcoming(c: Channel, clock: number): (Programme | undefined)[] {
  const i = programmeIndexAt(c, clock);
  return Array.from({ length: SLOT_COUNT }, (_, k) => c.schedule[i + k]);
}

export function describe(c: Channel, clock: number): string {
  const { now, next } = nowNext(c, clock);
  return `${c.name}, now: ${now.title} until ${fmtTime(now.end)}, next: ${next ? next.title : "later"}`;
}

export const categoryCount = (s: Pick<DemoState, "favs">, id: CategoryId) =>
  id === "all" ? CHANNELS.length : id === "fav" ? s.favs.length : CHANNELS.filter((c) => c.category === id).length;

export const emptyMessage = (s: Pick<DemoState, "query">) =>
  s.query.trim() ? 'No signal on that one. Try "news".' : "No favourites yet. Press F on a channel to add one.";

/* ---------- reducer ---------- */

/** Keep the roving focus on a channel that is still listed. */
function settle(s: DemoState): DemoState {
  const v = visibleChannels(s);
  if (!v.length || v.some((c) => c.id === s.focus.channelId)) return s;
  return { ...s, focus: { channelId: v[0]!.id, slotIndex: 0 } };
}

const count = (n: number) => (n === 0 ? "No channels" : n === 1 ? "1 channel" : `${n} channels`);

export function reducer(s: DemoState, a: DemoAction): DemoState {
  switch (a.type) {
    case "setCategory": {
      if (a.category === s.category) return s;
      const next = settle({ ...s, category: a.category });
      return { ...next, announce: `${categoryLabel(a.category)}: ${count(visibleChannels(next).length)}` };
    }
    case "setQuery": {
      const next = settle({ ...s, query: a.query });
      const n = visibleChannels(next).length;
      return { ...next, announce: a.query.trim() ? (n ? `${count(n)} match` : "No channels match") : count(n) };
    }
    case "moveFocus": {
      const v = visibleChannels(s);
      if (!v.length) return s;
      const i = Math.max(0, v.findIndex((c) => c.id === s.focus.channelId));
      const target = v[Math.max(0, Math.min(v.length - 1, i + a.delta))]!;
      return { ...s, focus: { ...s.focus, channelId: target.id } };
    }
    case "focusEdge": {
      const v = visibleChannels(s);
      if (!v.length) return s;
      return { ...s, focus: { ...s.focus, channelId: (a.edge === "first" ? v[0]! : v[v.length - 1]!).id } };
    }
    case "moveSlot": {
      const slotIndex = Math.max(0, Math.min(SLOT_COUNT - 1, s.focus.slotIndex + a.delta));
      const c = channelById(s.focus.channelId);
      const p = upcoming(c, s.clock)[slotIndex];
      return { ...s, focus: { ...s.focus, slotIndex }, announce: p ? `${c.name}, ${fmtTime(p.start)}, ${p.title}` : s.announce };
    }
    case "play": {
      const c = channelById(a.channelId);
      return { ...s, playing: c.id, focus: { ...s.focus, channelId: c.id }, announce: `Selected: ${describe(c, s.clock)}` };
    }
    case "toggleFavourite": {
      const c = channelById(a.channelId);
      const on = !s.favs.includes(c.id);
      const favs = on ? [...s.favs, c.id] : s.favs.filter((id) => id !== c.id);
      return settle({ ...s, favs, announce: `${c.name} ${on ? "added to" : "removed from"} favourites` });
    }
    case "toggleTv":
      return { ...s, mode: s.mode === "tv" ? "guide" : "tv", announce: s.mode === "tv" ? "TV mode off" : "TV mode on" };
    case "setRaw":
      return a.value === s.showRawNames ? s : { ...s, showRawNames: a.value, announce: a.value ? "Showing names as the source sends them" : "Showing tidied names" };
    case "tick":
      return settle({ ...s, clock: s.clock >= CLOCK_END ? CLOCK_START : s.clock + 1 }); // a search matches on-screen programmes, so the list can change as time moves
  }
}

