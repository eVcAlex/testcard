import { memo, useState } from "react";
import { Pressable, Text } from "react-native";
import { useFocusTracking } from "./Focusable";
import { colors, styleSheet } from "../theme";

export const PILL_HEIGHT = 56;

/**
 * One choice in a horizontal row (the Live TV categories). Quiet at rest, a lifted grey when it is the open
 * one, filled cream under the remote's focus. Handlers take the pill's `id` so a row can share two functions and
 * let `memo` work.
 */
export const Pill = memo(function Pill({
  id,
  label,
  active = false,
  onPressId,
  onFocusId,
}: {
  id: string;
  label: string;
  active?: boolean;
  onPressId: (id: string) => void;
  onFocusId?: ((id: string) => void) | undefined;
}) {
  const [focused, setFocused] = useState(false);
  const tracking = useFocusTracking();
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
      style={[styles.pill, active && styles.active, focused && styles.focused]}
    >
      <Text numberOfLines={1} style={[styles.label, active && !focused && styles.labelActive, focused && styles.labelFocused]}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = styleSheet({
  pill: { height: PILL_HEIGHT, justifyContent: "center", paddingHorizontal: 28, borderRadius: PILL_HEIGHT / 2, borderWidth: 3, borderColor: "transparent", backgroundColor: colors.card },
  // A quiet outline, not a fill: a filled "active" pill read as identical to a filled "focused" one, so
  // moving the remote's cursor over another pill looked like it had switched the selection.
  active: { borderColor: "#ffffff66" },
  focused: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { color: colors.muted, fontSize: 24, fontWeight: "400" },
  labelActive: { color: colors.foreground, fontWeight: "500" },
  labelFocused: { color: colors.accentInk, fontWeight: "500" },
});
