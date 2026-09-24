import { memo, useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusTracking, type lastFocused } from "./Focusable";
import { colors, styleSheet } from "../theme";

/** A section tab in the top bar: grey at rest, white with an accent underline when open, a glass pill under the remote's focus. */
export const NavTab = memo(function NavTab({
  id,
  label,
  icon,
  active,
  preferred = false,
  badge = false,
  chip = false,
  trailing,
  handle,
  onFocusChange,
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
  /** A filter on what the pages show rather than a place to go: never underlined, and its trailing glyph sits closer. */
  chip?: boolean;
  /** A glyph after the label (a chip's drop-down arrow), in the label's colour. */
  trailing?: (color: string) => ReactNode;
  /** Filled with the tab's view, so the app can send the remote's focus to it (Back from a page). */
  handle?: typeof lastFocused;
  onFocusChange?: (focused: boolean) => void;
  onPressId: (id: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const tracking = useFocusTracking();
  useEffect(() => {
    if (handle === undefined) return;
    handle.current = tracking.ref.current;
    return () => {
      handle.current = null;
    };
  }, [handle, tracking.ref]);
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
        onFocusChange?.(true);
      }}
      onBlur={() => {
        setFocused(false);
        tracking.blurred();
        onFocusChange?.(false);
      }}
      style={[styles.tab, icon !== undefined && label === undefined && styles.iconTab, chip && styles.chip, focused && styles.tabFocused]}
    >
      {icon?.(on ? colors.foreground : colors.muted)}
      {label !== undefined ? <Text style={[styles.label, { color: on ? colors.foreground : colors.muted }, on && styles.labelOn]}>{label}</Text> : null}
      {trailing?.(on ? colors.foreground : colors.muted)}
      {badge ? <View style={[styles.badge, label === undefined && styles.badgeCorner]} /> : null}
      {active && !focused && !chip ? <View style={[styles.underline, label === undefined && styles.underlineShort]} /> : null}
    </Pressable>
  );
});

const styles = styleSheet({
  tab: { height: 60, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 28, borderRadius: 30 },
  iconTab: { width: 60, paddingHorizontal: 0, justifyContent: "center" },
  tabFocused: { backgroundColor: "#ffffff1f" },
  label: { fontSize: 26, fontWeight: "400" },
  labelOn: { fontWeight: "500" },
  chip: { gap: 6, paddingRight: 22 },
  badge: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  badgeCorner: { position: "absolute", top: 10, right: 10 },
  underlineShort: { left: 18, right: 18 },
  underline: { position: "absolute", bottom: 4, left: 28, right: 28, height: 3, borderRadius: 2, backgroundColor: colors.accent },
});
