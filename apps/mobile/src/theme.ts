import { Dimensions, Platform, StyleSheet } from "react-native";

/** The desktop "Mist" palette (apps/desktop/src/renderer/src/styles/tokens.css), dark only, sized for a TV. */
export const colors = {
  background: "#14171a",
  sunken: "#0f1214",
  raised: "#1a1d21",
  card: "#1c2024",
  cardActive: "#2b3138",
  border: "#262c31",
  foreground: "#eef1f3",
  muted: "#949ca4",
  faint: "#69727a",
  accent: "#4fb3a6",
  accentInk: "#06211e",
  accentSoft: "#4fb3a626",
  fault: "#f0745c",
  live: "#e8402a",
} as const;

/** Text sizes are large on purpose: a Fire TV is read from a sofa. */
export const type = { body: 22, small: 18, lead: 28, title: 40 } as const;
export const space = { s: 8, m: 16, l: 24, xl: 40 } as const;

/**
 * Every size in this app is written for a 1920 px wide screen. A Fire TV reports its window in dp, and
 * a 1080p one is only 960 dp wide, so unscaled that design renders twice too big. `styleSheet` scales
 * each length by (window width / 1920); phones are left alone.
 */
const DESIGN_WIDTH = 1920;
export const uiScale = (() => {
  if (!Platform.isTV) return 1;
  const { width, height } = Dimensions.get("window");
  return Math.min(1.5, Math.max(0.4, Math.max(width, height) / DESIGN_WIDTH));
})();

const SCALED_KEYS = new Set([
  "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
  "padding", "paddingVertical", "paddingHorizontal", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight",
  "margin", "marginVertical", "marginHorizontal", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "gap", "rowGap", "columnGap", "top", "left", "right", "bottom",
  "fontSize", "lineHeight", "letterSpacing",
  "borderRadius", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius",
  "borderWidth", "borderTopWidth", "borderBottomWidth", "borderLeftWidth", "borderRightWidth",
]);

/** `StyleSheet.create` for lengths written in 1920 px design units. */
export function styleSheet<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(styles: T): T {
  const scaled: Record<string, unknown> = {};
  for (const [name, style] of Object.entries(styles)) {
    scaled[name] = Object.fromEntries(
      Object.entries(style as Record<string, unknown>).map(([key, value]) => {
        if (typeof value !== "number" || !SCALED_KEYS.has(key)) return [key, value];
        const result = Math.round(value * uiScale);
        return [key, key.includes("Width") && value > 0 ? Math.max(1, result) : result];
      }),
    );
  }
  return StyleSheet.create(scaled as T);
}
