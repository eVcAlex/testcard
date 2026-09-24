import type Database from "better-sqlite3";
import type { AudioTrack, VideoContentFit } from "expo-video";
import { speaks, trackLanguage } from "./captions";

/**
 * The player's options row: how the picture fills the screen, how fast it plays, and which soundtrack. Picture size
 * is kept per channel on this device (a badly flagged feed stays fixed); speed is never kept, as on the streaming
 * apps; the soundtrack's language is kept, like the captions language, and chosen again on the next film.
 */

export const PICTURE_FITS: readonly { readonly fit: VideoContentFit; readonly label: string }[] = [
  { fit: "contain", label: "Fit" },
  { fit: "cover", label: "Fill" },
  { fit: "fill", label: "Stretch" },
];

export const pictureLabel = (fit: VideoContentFit) => PICTURE_FITS.find((entry) => entry.fit === fit)?.label ?? "Fit";

export function nextFit(fit: VideoContentFit): VideoContentFit {
  const at = PICTURE_FITS.findIndex((entry) => entry.fit === fit);
  return PICTURE_FITS[(at + 1) % PICTURE_FITS.length]?.fit ?? "contain";
}

export const SPEEDS: readonly number[] = [1, 1.25, 1.5, 2, 0.75];

export const speedLabel = (rate: number) => `${rate}×`;

export const nextSpeed = (rate: number) => SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length] ?? 1;

const fitKey = (channelId: string) => `ui:fit:${channelId}`;

export function readPictureFit(db: Database.Database, channelId: string): VideoContentFit {
  try {
    const row = db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(fitKey(channelId)) as { value: string } | undefined;
    return PICTURE_FITS.find((entry) => entry.fit === row?.value)?.fit ?? "contain";
  } catch {
    return "contain";
  }
}

export function writePictureFit(db: Database.Database, channelId: string, fit: VideoContentFit): void {
  try {
    // Fit is the default, so choosing it again takes the channel's row away rather than keeping one per channel.
    if (fit === "contain") db.prepare(`DELETE FROM schema_meta WHERE key = ?`).run(fitKey(channelId));
    else db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(fitKey(channelId), fit);
  } catch {
    // Only the next visit to this channel would miss it.
  }
}

/** A soundtrack as the list shows it. */
export function audioName(track: AudioTrack): string {
  const said = track.label !== "" ? track.label : track.name !== undefined && track.name !== "" ? track.name : track.language;
  return said !== "" ? said : "Soundtrack";
}

/** The two-letter language of the soundtrack the viewer picked, to pick again on the next film, or null if it has none offered. */
export const audioLanguage = (track: AudioTrack) => trackLanguage(track);

/** The soundtrack in the viewer's language, or null to leave the stream's own default playing. */
export function autoAudioTrack(language: string | null, tracks: readonly AudioTrack[], current: AudioTrack | null): AudioTrack | null {
  if (language === null || tracks.length < 2) return null;
  if (current !== null && speaks(current, language)) return null;
  return tracks.find((track) => speaks(track, language)) ?? null;
}

const AUDIO_KEY = "ui:audio";

export function readAudioLanguage(db: Database.Database): string | null {
  try {
    const row = db.prepare(`SELECT value FROM schema_meta WHERE key = ?`).get(AUDIO_KEY) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function writeAudioLanguage(db: Database.Database, language: string | null): void {
  try {
    if (language === null) db.prepare(`DELETE FROM schema_meta WHERE key = ?`).run(AUDIO_KEY);
    else db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)`).run(AUDIO_KEY, language);
  } catch {
    // Only the next film would miss it.
  }
}
