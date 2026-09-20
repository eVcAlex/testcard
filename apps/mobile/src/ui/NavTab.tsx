import { memo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { colors, styleSheet } from "../theme";

/** A section tab in the top bar: grey at rest, white with an accent underline when open, a glass pill under the remote's focus. */
export const NavTab = memo(function NavTab({
  id,
  label,
  active,
  preferred = false,
  badge = false,
  onPressId,
}: {
  id: string;
  label: string;
  active: boolean;
  preferred?: boolean;
  /** A small accent dot: something here wants attention (an update). */
  badge?: boolean;
  onPressId: (id: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      hasTVPreferredFocus={preferred}
      onPress={() => onPressId(id)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.tab, focused && styles.tabFocused]}
    >
      <Text style={[styles.label, { color: focused || active ? colors.foreground : colors.muted }, (focused || active) && styles.labelOn]}>{label}</Text>
      {badge ? <View style={styles.badge} /> : null}
      {active && !focused ? <View style={styles.underline} /> : null}
    </Pressable>
  );
});

const styles = styleSheet({
  tab: { height: 60, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 28, borderRadius: 30 },
  tabFocused: { backgroundColor: "#ffffff1f" },
  label: { fontSize: 26, fontWeight: "400" },
  labelOn: { fontWeight: "500" },
  badge: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  underline: { position: "absolute", bottom: 4, left: 28, right: 28, height: 3, borderRadius: 2, backgroundColor: colors.accent },
});
