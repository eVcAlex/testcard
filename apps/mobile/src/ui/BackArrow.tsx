import { useState } from "react";
import { Pressable, View } from "react-native";
import { NavArrowLeft } from "iconoir-react-native";
import { colors, styleSheet, uiScale } from "../theme";

const u = (n: number) => Math.round(n * uiScale);
const INK = "#0b0e10";

/** The round "back" arrow at the top left of a page: a glass disc at rest, solid white under the remote's focus. */
export function BackArrow({ onPress }: { onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable focusable onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[styles.disc, focused && styles.discFocused]}>
      <NavArrowLeft width={u(32)} height={u(32)} strokeWidth={1.75} color={focused ? INK : colors.foreground} />
    </Pressable>
  );
}

const styles = styleSheet({
  disc: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff1f" },
  discFocused: { backgroundColor: colors.foreground },
});
