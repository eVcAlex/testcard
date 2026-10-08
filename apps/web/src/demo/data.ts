/** Invented demo content. No real channel, programme or provider appears here. Minutes are minutes since midnight. */

export type CategoryId = "all" | "fav" | "news" | "sport" | "films" | "ent";
type ContentCategory = Exclude<CategoryId, "all" | "fav">;
type SourceId = "a" | "b";

export interface Programme { start: number; end: number; title: string }
export interface Channel {
  id: string;
  /** Tidied name, as Testcard shows it. */
  name: string;
  /** The name as a source might send it. */
  raw: string;
  category: ContentCategory;
  quality: "HD" | "FHD" | "4K";
  source: SourceId;
  /** 0..11, picks the logo chip colour and the test-pattern hue. */
  hue: number;
  initials: string;
  schedule: readonly Programme[];
}

export const CATEGORIES: readonly { id: CategoryId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "fav", label: "Favourites" },
  { id: "news", label: "News" },
  { id: "sport", label: "Sport" },
  { id: "films", label: "Films" },
  { id: "ent", label: "Entertainment" },
];
export const categoryLabel = (id: CategoryId) => CATEGORIES.find((c) => c.id === id)!.label;

export const SOURCES: readonly { id: SourceId; name: string; kind: string }[] = [
  { id: "a", name: "Harbour Xtream", kind: "Xtream" },
  { id: "b", name: "Weekend M3U", kind: "M3U" },
];

/** The demo clock starts here, advances one minute per tick, and wraps from CLOCK_END back to CLOCK_START. */
export const CLOCK_START = 20 * 60 + 58;
export const CLOCK_END = 21 * 60 + 30;
const DAY_START = 18 * 60;
const DAY_END = 28 * 60;

const TITLES: Record<ContentCategory, readonly string[]> = {
  news: ["Harbour Tonight", "The Round-up", "Weather Front", "Business Close", "Regional Desk", "Late Bulletin", "Question Hour", "Overnight Briefing"],
  sport: ["Matchday Build-up", "Ridge League Live", "Highlights Show", "Pit Lane Weekly", "Court Report", "Late Kick-off"],
  films: ["The Lighthouse Keeper", "Night Train North", "A Quiet Harvest", "Seven Lanterns", "Paper Boats", "The Last Ferry", "Marble Hill"],
  ent: ["Studio Nine Live", "Lantern Hill", "Starfield Lab", "The Jam Session", "Coastline Walks", "Rainy Day Hours", "The Cellar Table", "Local Legends", "Night Garden"],
};
const DURATIONS = [60, 30, 30, 60, 90, 30, 60, 30, 120, 60];

function scheduleFor(index: number, category: ContentCategory): Programme[] {
  const pool = TITLES[category];
  const out: Programme[] = [];
  let t = DAY_START;
  let k = index;
  while (t < DAY_END) {
    const end = Math.min(t + DURATIONS[(k * 3 + index) % DURATIONS.length]!, DAY_END);
    out.push({ start: t, end, title: pool[(k + index) % pool.length]! });
    t = end;
    k++;
  }
  return out;
}

const SEED: readonly (readonly [id: string, name: string, raw: string, category: ContentCategory, quality: Channel["quality"], source: SourceId])[] = [
  ["harbour", "Harbour News", "UK| HARBOUR NEWS HD ◉", "news", "HD", "a"],
  ["tide", "Tidewater Weather", "|UK| TIDEWATER WEATHER ᴴᴰ", "news", "HD", "a"],
  ["summit", "Summit Report", "EU: SUMMIT REPORT FHD [MULTI-SUB]", "news", "FHD", "b"],
  ["peak", "Peak Sport", "UK| ᴘᴇᴀᴋ ꜱᴘᴏʀᴛ ⁴ᴷ", "sport", "4K", "a"],
  ["peak2", "Peak Sport 2", "★ UK ★ PEAK SPORT 2 FHD", "sport", "FHD", "a"],
  ["cinema", "Late Night Cinema", "VIP| LATE NIGHT CINEMA FHD", "films", "FHD", "b"],
  ["moon", "Paper Moon Films", "VIP| PAPER MOON FILMS HD ●", "films", "HD", "b"],
  ["ember", "Ember Classics", "UK| EMBER CLASSICS HD (backup)", "films", "HD", "a"],
  ["s9", "Studio 9", "UK: STUDIO 9 HD", "ent", "HD", "a"],
  ["lantern", "Lantern Drama", "EU| LANTERN DRAMA FHD ★", "ent", "FHD", "b"],
  ["nova", "Nova Science", "|EU| NOVA SCIENCE HD", "ent", "HD", "b"],
  ["marm", "Marmalade Kitchen", "UK| MARMALADE KITCHEN HD ᵁᴷ", "ent", "HD", "a"],
  ["north", "Northbound Travel", "EU| NORTHBOUND TRAVEL FHD", "ent", "FHD", "b"],
  ["quiet", "Quiet Hours", "UK| QUIET HOURS HD", "ent", "HD", "a"],
];

export const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export const CHANNELS: readonly Channel[] = SEED.map(([id, name, raw, category, quality, source], i) => ({
  id,
  name,
  raw,
  category,
  quality,
  source,
  hue: hash(id) % 12,
  initials: name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(),
  schedule: scheduleFor(i, category),
}));

export const channelById = (id: string): Channel => CHANNELS.find((c) => c.id === id) ?? CHANNELS[0]!;

/** Channels shown in the "Names, tidied" section: the same invented data as the guide. */
export const NAME_EXAMPLES = ["harbour", "summit", "peak", "cinema", "lantern", "marm"] as const;

export const INITIAL_FAVOURITES: readonly string[] = ["peak", "moon"];
export const INITIAL_CHANNEL = "harbour";
/** Rows shown on narrow screens before "Show all channels". */
export const COLLAPSED_ROWS = 6;
/** Programme columns in the wide guide: now, next, then two later ones. */
export const SLOT_COUNT = 4;
