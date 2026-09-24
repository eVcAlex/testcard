import { memo } from "react";
import { Text, View } from "react-native";
import { CAPTION_TEXT_FRACTION, captionLook, type CaptionPrefs } from "../playback/captions";
import { styleSheet, uiScale } from "../theme";

/** The frame's size in design units: 16:9, like the picture the captions will sit on. */
const WIDTH = 720;
const HEIGHT = 405;

/**
 * A still of how captions will look: a dim scene with two lines of dialogue drawn at the size, colour, background
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
  const line = [{ color: look.color, fontSize, lineHeight: Math.round(fontSize * 1.3) }, look.background !== null && { backgroundColor: look.background }, edge];
  return (
    <View style={styles.frame}>
      {/* A night scene in flat shapes: sky, a lit window, the ground. Enough for the text to be judged against a picture. */}
      <View style={styles.sky} />
      <View style={styles.glow} />
      <View style={styles.window} />
      <View style={styles.ground} />
      <View style={styles.captions}>
        <Text style={[styles.text, ...line]}>{" I told you we'd make it back "}</Text>
        <Text style={[styles.text, ...line]}>{" before it got dark. "}</Text>
      </View>
    </View>
  );
});

const styles = styleSheet({
  frame: { width: WIDTH, height: HEIGHT, overflow: "hidden", borderRadius: 14, backgroundColor: "#1b2533" },
  sky: { position: "absolute", left: 0, right: 0, top: 0, height: 250, backgroundColor: "#2a3a52" },
  glow: { position: "absolute", left: 420, top: 70, width: 220, height: 220, borderRadius: 110, backgroundColor: "#e7b86a22" },
  window: { position: "absolute", left: 500, top: 140, width: 60, height: 80, borderRadius: 4, backgroundColor: "#f0c77a" },
  ground: { position: "absolute", left: 0, right: 0, bottom: 0, height: 155, backgroundColor: "#5d6570" },
  captions: { position: "absolute", left: 0, right: 0, bottom: "8%", alignItems: "center" },
  text: { textAlign: "center", fontWeight: "500" },
});
