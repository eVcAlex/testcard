import { memo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusTracking } from "./Focusable";
import { colors, styleSheet } from "../theme";

/** A section tab in the top bar: grey at rest, white with an accent underline when open, a glass pill under the remote's focus. */
export const NavTab = memo(function NavTab({
  id,
  label,
  icon,
  active,
  preferred = false,
  badge = false,
  onPressId,
}: {
  id: string;
  /** Omit for an icon-only tab. */
  label?: string;
  /** An icon-only tab's glyph, given the colour it should draw in (matches the label's focus/active colour). */
  icon?: (color: string) => ReactNode;
  active: boolean;
  preferred?: boolean;
  /** A small accent dot: something here wants attention (an update). */
  badge?: boolean;
  onPressId: (id: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const tracking = useFocusTracking();
  const on = focused || active;
  return (
    <Pressable
      ref={tracking.ref}
      focusable
      hasTVPreferredFocus={preferred}
      onPress={() => onPressId(id)}
      onFocus={() => {
        setFocused(true);
        tracking.focused();
      }}
      onBlur={() => {
        setFocused(false);
        tracking.blurred();
      }}
      style={[styles.tab, icon !== undefined && label === undefined && styles.iconTab, focused && styles.tabFocused]}
    >
      {icon?.(on ? colors.foreground : colors.muted)}
      {label !== undefined ? <Text style={[styles.label, { color: on ? colors.foreground : colors.muted }, on && styles.labelOn]}>{label}</Text> : null}
      {badge ? <View style={styles.badge} /> : null}
      {active && !focused ? <View style={styles.underline} /> : null}
    </Pressable>
  );
});

const styles = styleSheet({
  tab: { height: 60, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 28, borderRadius: 30 },
  iconTab: { width: 60, paddingHorizontal: 0, justifyContent: "center" },
  tabFocused: { backgroundColor: "#ffffff1f" },
  label: { fontSize: 26, fontWeight: "400" },
  labelOn: { fontWeight: "500" },
  badge: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  underline: { position: "absolute", bottom: 4, left: 28, right: 28, height: 3, borderRadius: 2, backgroundColor: colors.accent },
});
