import type Database from "better-sqlite3";
import type { SubtitleTrack } from "expo-video";

/**
 * How captions look and when they come on by themselves. This device's own setting (a TV and a phone are read
 * from different distances), kept in `schema_meta` beside the source pick, not synced.
 */
export interface CaptionPrefs {
  /** Films and episodes start with captions on, in `language`. Live TV never does. */
  readonly always: boolean;
  /** A two-letter code, or "any" for whichever track comes first. */
  readonly language: string;
  readonly size: "small" | "medium" | "large" | "huge";
  readonly color: "white" | "yellow" | "cream";
  readonly background: "none" | "shaded" | "solid";
  readonly edge: "shadow" | "outline" | "none";
}

export const DEFAULT_CAPTIONS: CaptionPrefs = { always: false, language: "en", size: "medium", color: "white", background: "none", edge: "shadow" };

/** Languages offered for "always on", by two-letter code, with the three-letter codes and names a track may use instead. */
const LANGUAGES: readonly { code: string; name: string; also: readonly string[] }[] = [
  { code: "en", name: "English", also: ["eng"] },
  { code: "es", name: "Spanish", also: ["spa", "esl", "español", "espanol", "castellano"] },
  { code: "fr", name: "French", also: ["fre", "fra", "français", "francais"] },
  { code: "de", name: "German", also: ["ger", "deu", "deutsch"] },
  { code: "it", name: "Italian", also: ["ita", "italiano"] },
  { code: "pt", name: "Portuguese", also: ["por", "português", "portugues"] },
  { code: "nl", name: "Dutch", also: ["dut", "nld", "nederlands"] },
  { code: "pl", name: "Polish", also: ["pol", "polski"] },
  { code: "sv", name: "Swedish", also: ["swe", "svenska"] },
  { code: "da", name: "Danish", also: ["dan", "dansk"] },
  { code: "no", name: "Norwegian", also: ["nor", "nob", "nno", "nb", "nn", "norsk"] },
  { code: "fi", name: "Finnish", also: ["fin", "suomi"] },
  { code: "el", name: "Greek", also: ["gre", "ell"] },
  { code: "tr", name: "Turkish", also: ["tur", "türkçe", "turkce"] },
  { code: "ar", name: "Arabic", also: ["ara"] },
  { code: "hi", name: "Hindi", also: ["hin"] },
  { code: "ja", name: "Japanese", also: ["jpn"] },
  { code: "ko", name: "Korean", also: ["kor"] },
  { code: "zh", name: "Chinese", also: ["chi", "zho", "mandarin", "cantonese"] },
];

export interface CaptionSetting {
  readonly key: keyof CaptionPrefs;
  readonly label: string;
  readonly values: readonly { readonly id: string; readonly label: string }[];
}

/** The settings, in the order they are listed, each with its choices. Shared by the settings page and the player's captions panel. */
export const CAPTION_SETTINGS: readonly CaptionSetting[] = [
  { key: "always", label: "On for films and episodes", values: [{ id: "false", label: "Only when I turn them on" }, { id: "true", label: "Always" }] },
  { key: "language", label: "Language", values: [{ id: "any", label: "Any" }, ...LANGUAGES.map((entry) => ({ id: entry.code, label: entry.name }))] },
  { key: "size", label: "Size", values: [{ id: "small", label: "Small" }, { id: "medium", label: "Medium" }, { id: "large", label: "Large" }, { id: "huge", label: "Extra large" }] },
  { key: "color", label: "Text colour", values: [{ id: "white", label: "White" }, { id: "yellow", label: "Yellow" }, { id: "cream", label: "Cream" }] },
  { key: "background", label: "Background", values: [{ id: "none", label: "None" }, { id: "shaded", label: "Shaded box" }, { id: "solid", label: "Solid box" }] },
  { key: "edge", label: "Text edge", values: [{ id: "shadow", label: "Drop shadow" }, { id: "outline", label: "Outline" }, { id: "none", label: "None" }] },
];

/** The choice a setting has now, as its id. */
export const settingValue = (prefs: CaptionPrefs, key: keyof CaptionPrefs): string => String(prefs[key]);

export function settingLabel(prefs: CaptionPrefs, setting: CaptionSetting): string {
  const id = settingValue(prefs, setting.key);
  return setting.values.find((value) => value.id === id)?.label ?? id;
}

/** The prefs with one setting changed, by its choice's id. */
export function withSetting(prefs: CaptionPrefs, key: keyof CaptionPrefs, id: string): CaptionPrefs {
  return { ...prefs, [key]: key === "always" ? id === "true" : id };
}

/** One step through a setting's choices, wrapping round. */
export function stepSetting(prefs: CaptionPrefs, setting: CaptionSetting, direction: 1 | -1): CaptionPrefs {
  const at = setting.values.findIndex((value) => value.id === settingValue(prefs, setting.key));
  const next = setting.values[(at + direction + setting.values.length) % setting.values.length];
  return next === undefined ? prefs : withSetting(prefs, setting.key, next.id);
}

const PREFS_KEY = "ui:captions";

export function readCaptionPrefs(db: Database.Database): CaptionPrefs {
  try {
    const row = db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(PREFS_KEY) as { value: string } | undefined;
    if (row === undefined) return DEFAULT_CAPTIONS;
    const stored = JSON.parse(row.value) as Partial<CaptionPrefs>;
    // Anything missing or no longer offered falls back to the default, one setting at a time.
    let prefs = DEFAULT_CAPTIONS;
    for (const setting of CAPTION_SETTINGS) {
      const id = stored[setting.key];
      if (id !== undefined && setting.values.some((value) => value.id === String(id))) prefs = withSetting(prefs, setting.key, String(id));
    }
    return prefs;
  } catch {
    return DEFAULT_CAPTIONS;
  }
}

export function writeCaptionPrefs(db: Database.Database, prefs: CaptionPrefs): void {
  try {
    db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Only the next launch would miss it.
  }
}

/** What a subtitle or audio track says about itself. */
interface LabelledTrack {
  readonly language?: string | null | undefined;
  readonly label?: string | null | undefined;
  readonly name?: string | null | undefined;
}

/** Whether a track is in the given language, by its code or, failing that, the name in its label. */
export function speaks(track: LabelledTrack, code: string): boolean {
  const language = LANGUAGES.find((entry) => entry.code === code);
  const said = (track.language ?? "").toLowerCase();
  const primary = said.split(/[-_]/)[0] ?? "";
  if (primary === code || (language?.also.includes(primary) ?? false)) return true;
  const label = `${track.label ?? ""} ${track.name ?? ""}`.toLowerCase();
  return language !== undefined && [language.name.toLowerCase(), ...language.also.filter((word) => word.length > 3)].some((word) => label.includes(word));
}

/** A track that only covers foreign-language lines, not the whole programme. */
const forcedOnly = (track: SubtitleTrack) => /forced/i.test(`${track.label ?? ""} ${track.name ?? ""}`);

/**
 * The track to turn on by itself when a film or episode starts, or null to leave captions off: none unless the
 * viewer has asked for them always, and none in another language than the one they chose (wrong-language captions
 * are worse than none). A full track is preferred over a forced-only one.
 */
export function autoCaptionTrack(prefs: CaptionPrefs, tracks: readonly SubtitleTrack[]): SubtitleTrack | null {
  if (!prefs.always || tracks.length === 0) return null;
  const matching = prefs.language === "any" ? tracks : tracks.filter((track) => speaks(track, prefs.language));
  return matching.find((track) => !forcedOnly(track)) ?? matching[0] ?? null;
}

/** The two-letter code a track is in, when it is one of the languages offered, or null. */
export function trackLanguage(track: LabelledTrack): string | null {
  return LANGUAGES.find((entry) => speaks(track, entry.code))?.code ?? null;
}

/** How captions look, in the terms both the native player and the settings preview use. Colours are #RRGGBB or #RRGGBBAA. */
export function captionLook(prefs: CaptionPrefs) {
  return { textScale: TEXT_SCALE[prefs.size], color: TEXT_COLOR[prefs.color], background: BACKGROUND[prefs.background], edge: prefs.edge };
}

/** Media3 draws captions this share of the picture's height tall at scale 1 (SubtitleView.DEFAULT_TEXT_SIZE_FRACTION). */
export const CAPTION_TEXT_FRACTION = 0.0533;

const TEXT_SCALE: Record<CaptionPrefs["size"], number> = { small: 0.8, medium: 1, large: 1.3, huge: 1.65 };
const TEXT_COLOR: Record<CaptionPrefs["color"], string> = { white: "#ffffff", yellow: "#ffe13c", cream: "#e7d2ad" };
const BACKGROUND: Record<CaptionPrefs["background"], string | null> = { none: null, shaded: "#00000096", solid: "#000000" };
/** Media3's CaptionStyleCompat edge types. */
const EDGE: Record<CaptionPrefs["edge"], number> = { none: 0, outline: 1, shadow: 2 };

/** #RRGGBB or #RRGGBBAA as the signed 32-bit ARGB integer the native side takes. */
function argb(hex: string): number {
  const alpha = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
  return (alpha << 24) | parseInt(hex.slice(1, 7), 16);
}

/** What the video view's `captionStyle` takes (Android; see patches/expo-video). */
export function nativeCaptionStyle(prefs: CaptionPrefs) {
  const look = captionLook(prefs);
  return {
    textScale: look.textScale,
    foregroundColor: argb(look.color),
    backgroundColor: look.background === null ? 0 : argb(look.background),
    windowColor: 0,
    edgeType: EDGE[prefs.edge],
    edgeColor: argb("#000000"),
  };
}
