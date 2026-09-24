import { memo, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import type Database from "better-sqlite3";
import { CAPTION_TEXT_FRACTION, captionLook, type CaptionPrefs } from "../playback/captions";
import { useApp } from "../state/app";
import { styleSheet, uiScale } from "../theme";

/** The frame's size in design units: 16:9, like the picture the captions will sit on. */
const WIDTH = 720;
const HEIGHT = 405;

/**
 * A still of how captions will look: artwork from the viewer's own library (what they watched last, softened so
 * it reads as a picture rather than a poster) with two lines of dialogue drawn at the size, colour, background
 * and edge chosen, in proportion to the frame as the player draws them on the picture. The edge is an approximation
 * (React Native text has a shadow but no stroke), close enough to choose by.
 */
export const CaptionPreview = memo(function CaptionPreview({ prefs }: { prefs: CaptionPrefs }) {
  const look = captionLook(prefs);
  const fontSize = Math.round(HEIGHT * CAPTION_TEXT_FRACTION * look.textScale * uiScale);
  const edge =
    look.edge === "shadow"
      ? { textShadowColor: "#000000", textShadowOffset: { width: fontSize * 0.08, height: fontSize * 0.08 }, textShadowRadius: fontSize * 0.12 }
      : look.edge === "outline"
        ? { textShadowColor: "#000000", textShadowOffset: { width: 0, height: 0 }, textShadowRadius: fontSize * 0.2 }
        : {};
  const { db } = useApp();
  const still = useMemo(() => stillFrom(db), [db]);
  const [broken, setBroken] = useState(false);
  const line = [{ color: look.color, fontSize, lineHeight: Math.round(fontSize * 1.3) }, look.background !== null && { backgroundColor: look.background }, edge];
  return (
    <View style={styles.frame}>
      {still !== null && !broken ? (
        <Image source={{ uri: still }} style={styles.still} contentFit="cover" blurRadius={4} cachePolicy="memory-disk" onError={() => setBroken(true)} />
      ) : null}
      <View style={styles.shade} />
      <View style={styles.captions}>
        <Text style={[styles.text, ...line]}>{" I told you we'd make it back "}</Text>
        <Text style={[styles.text, ...line]}>{" before it got dark. "}</Text>
      </View>
    </View>
  );
});

/** Artwork for the still: the film or series watched most recently, else any in the library, else none (a plain frame). */
function stillFrom(db: Database.Database): string | null {
  try {
    const recent = db
      .prepare(
        `SELECT url FROM (
           SELECT m.poster_url AS url, r.played_at AS at FROM movie_recents r JOIN movies m ON m.id = r.movie_id
           UNION ALL
           SELECT s.poster_url AS url, r.played_at AS at FROM series_recents r JOIN series s ON s.id = r.series_id
         ) WHERE url IS NOT NULL AND url <> '' ORDER BY at DESC LIMIT 1`,
      )
      .get() as { url: string } | undefined;
    if (recent !== undefined) return recent.url;
    const any = db.prepare(`SELECT poster_url AS url FROM movies WHERE poster_url IS NOT NULL AND poster_url <> '' LIMIT 1`).get() as { url: string } | undefined;
    return any?.url ?? null;
  } catch {
    return null;
  }
}

const styles = styleSheet({
  frame: { width: WIDTH, height: HEIGHT, overflow: "hidden", borderRadius: 14, backgroundColor: "#16191d" },
  still: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  // Dims the artwork to the brightness of a scene, so the captions are judged against a picture, not a bright poster.
  shade: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "#00000059" },
  captions: { position: "absolute", left: 0, right: 0, bottom: "8%", alignItems: "center" },
  text: { textAlign: "center", fontWeight: "500" },
});
