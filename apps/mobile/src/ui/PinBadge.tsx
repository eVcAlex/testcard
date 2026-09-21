import { Text, View } from "react-native";
import { colors, styleSheet } from "../theme";

/** A small "Pinned" tag beside a row's title, so a category you pinned to Home reads as yours. */
export function PinBadge() {
  return (
    <View style={styles.badge}>
      <View style={styles.pin} />
      <Text style={styles.text}>Pinned</Text>
    </View>
  );
}

const styles = styleSheet({
  badge: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 5, borderRadius: 999, borderWidth: 2, borderColor: colors.accent },
  pin: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  text: { color: colors.accent, fontSize: 20, fontWeight: "600", letterSpacing: 0.5 },
});
