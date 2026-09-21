import { memo, useState } from "react";
import { Pressable, Text } from "react-native";
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
  return (
    <Pressable
      focusable
      onPress={() => onPressId(id)}
      onFocus={() => {
        setFocused(true);
        onFocusId?.(id);
      }}
      onBlur={() => setFocused(false)}
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
  active: { backgroundColor: colors.cardActive },
  focused: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { color: colors.muted, fontSize: 24, fontWeight: "400" },
  labelActive: { color: colors.foreground, fontWeight: "500" },
  labelFocused: { color: colors.accentInk, fontWeight: "500" },
});
