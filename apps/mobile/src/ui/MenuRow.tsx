import { memo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useFocusTracking } from "./Focusable";
import { colors, styleSheet } from "../theme";

export const ROW_HEIGHT = 60;

/** 12345 -> "12,345". `toLocaleString` is not dependable on every Hermes build. */
export const withCommas = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * One line of a vertical menu (the category list). Idle rows are quiet grey, the open one is white with an
 * accent tick, and the remote's focus is a soft glass pill. Handlers take the row's `id` so the parent can
 * pass the same two functions to every row and let `memo` work.
 */
export const MenuRow = memo(function MenuRow({
  id,
  label,
  active = false,
  indent = false,
  open,
  onPressId,
  onFocusId,
}: {
  id: string;
  label: string;
  active?: boolean;
  indent?: boolean;
  /** Present on an expandable heading: whether it is expanded. */
  open?: boolean | undefined;
  onPressId: (id: string) => void;
  onFocusId?: ((id: string) => void) | undefined;
}) {
  const [focused, setFocused] = useState(false);
  const tracking = useFocusTracking();
  const ink = focused || active ? colors.foreground : colors.muted;
  return (
    <Pressable
      ref={tracking.ref}
      focusable
      onPress={() => onPressId(id)}
      onFocus={() => {
        tracking.focused();
        setFocused(true);
        onFocusId?.(id);
      }}
      onBlur={() => {
        setFocused(false);
        tracking.blurred();
      }}
      style={[styles.row, indent && styles.indent, focused && styles.rowFocused]}
    >
      {active && !focused ? <View style={styles.tick} /> : null}
      {open !== undefined ? <View style={[styles.chevron, { borderColor: ink, transform: [{ rotate: open ? "45deg" : "-45deg" }] }]} /> : null}
      <Text numberOfLines={1} style={[styles.label, { color: ink }, (active || focused) && styles.labelOn]}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = styleSheet({
  row: { height: ROW_HEIGHT, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 26, borderRadius: 16 },
  indent: { paddingLeft: 52 },
  rowFocused: { backgroundColor: "#ffffff1f" },
  tick: { position: "absolute", left: 8, width: 4, height: 26, borderRadius: 2, backgroundColor: colors.accent },
  label: { flex: 1, fontSize: 25, fontWeight: "400" },
  labelOn: { fontWeight: "500" },
  chevron: { width: 11, height: 11, borderRightWidth: 3, borderBottomWidth: 3, marginRight: 4 },
});
