import { useRef, useState, type ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type View, type ViewStyle } from "react-native";
import { colors, styleSheet } from "../theme";

type FocusTarget = View & { requestTVFocus?: () => void };
/** The view that last took remote focus, so a screen that covered the app can hand focus back to it on Back. */
export const lastFocused: { current: FocusTarget | null } = { current: null };
/** The one that has focus now, or null when focus is on something that is not a Focusable (or nowhere). */
export const focusedNow: { current: FocusTarget | null } = { current: null };

/**
 * For a pressable drawn by hand rather than through Focusable (the detail buttons, pills, menu rows, nav tabs): the
 * same bookkeeping, so a page that covers the app hands focus back to it on Back. Spread `ref` on the Pressable and
 * call `focused` / `blurred` from its onFocus / onBlur.
 */
export function useFocusTracking() {
  const ref = useRef<View>(null);
  return {
    ref,
    focused: () => {
      lastFocused.current = ref.current;
      focusedNow.current = ref.current;
    },
    blurred: () => {
      if (focusedNow.current === ref.current) focusedNow.current = null;
    },
  };
}

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
  const ref = useRef<View>(null);
  return (
    <Pressable
      {...rest}
      ref={ref}
      hasTVPreferredFocus={preferred}
      focusable
      onFocus={(event) => {
        setFocused(true);
        lastFocused.current = ref.current;
        focusedNow.current = ref.current;
        rest.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        if (focusedNow.current === ref.current) focusedNow.current = null;
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
  focused: { borderColor: colors.accent },
});
