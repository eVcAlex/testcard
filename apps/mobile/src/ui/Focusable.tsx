import { useState, type ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { colors, styleSheet } from "../theme";

/**
 * The one interactive primitive. On a Fire TV remote there is no pointer: the D-pad moves focus
 * between these, so every one draws an obvious focus ring and takes a scale-up, and works as a
 * plain touch target on a phone. `preferred` claims focus when a screen opens.
 */
export function Focusable({
  children,
  style,
  focusedStyle,
  preferred = false,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  children: ReactNode | ((state: { focused: boolean }) => ReactNode);
  style?: StyleProp<ViewStyle>;
  focusedStyle?: StyleProp<ViewStyle>;
  preferred?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      {...rest}
      hasTVPreferredFocus={preferred}
      focusable
      onFocus={(event) => {
        setFocused(true);
        rest.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        rest.onBlur?.(event);
      }}
      style={[styles.base, style, focused && styles.focused, focused && focusedStyle]}
    >
      {typeof children === "function" ? children({ focused }) : children}
    </Pressable>
  );
}

const styles = styleSheet({
  base: { borderWidth: 3, borderColor: "transparent", borderRadius: 16 },
  focused: { borderColor: colors.accent, transform: [{ scale: 1.05 }] },
});
