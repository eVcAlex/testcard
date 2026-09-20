import { useState } from "react";
import { Pressable, View } from "react-native";
import { colors, styleSheet } from "../theme";

/** The round "back" arrow at the top left of a page: a glass disc at rest, solid white under the remote's focus. */
export function BackArrow({ onPress }: { onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable focusable onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[styles.disc, focused && styles.discFocused]}>
      <View style={[styles.chevron, { borderColor: focused ? "#0b0e10" : colors.foreground }]} />
    </Pressable>
  );
}

const styles = styleSheet({
  disc: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff1f" },
  discFocused: { backgroundColor: colors.foreground },
  chevron: { width: 18, height: 18, marginLeft: 6, borderLeftWidth: 4, borderBottomWidth: 4, transform: [{ rotate: "45deg" }] },
});
