import { tvColors } from "@testcard/theme";
import { Dimensions, Platform, StyleSheet } from "react-native";

/** Dark only, sized for a TV. The palette comes from `@testcard/theme`: desktop neutrals nudged darker, cream accent. */
export const colors = tvColors;

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

/** The app's typeface (Inter, as on the desktop). Android picks a font file per weight, so weights are mapped to families. */
const FONT_BY_WEIGHT: Record<string, string> = {
  "400": "Inter_400Regular",
  normal: "Inter_400Regular",
  "500": "Inter_500Medium",
  "600": "Inter_600SemiBold",
  "700": "Inter_600SemiBold",
  bold: "Inter_600SemiBold",
  "800": "Inter_600SemiBold",
};

/**
 * `StyleSheet.create` for lengths written in 1920 px design units. Text styles (anything with a
 * `fontSize` or `fontWeight`) also get the app's typeface for their weight.
 */
export function styleSheet<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(styles: T): T {
  const scaled: Record<string, unknown> = {};
  for (const [name, style] of Object.entries(styles)) {
    const entries = Object.entries(style as Record<string, unknown>).map(([key, value]): [string, unknown] => {
      if (typeof value !== "number" || !SCALED_KEYS.has(key)) return [key, value];
      const result = Math.round(value * uiScale);
      return [key, key.includes("Width") && value > 0 ? Math.max(1, result) : result];
    });
    const out = Object.fromEntries(entries);
    if ("fontSize" in out || "fontWeight" in out) {
      out.fontFamily ??= FONT_BY_WEIGHT[String(out.fontWeight ?? "400")] ?? "Inter_400Regular";
      delete out.fontWeight;
    }
    scaled[name] = out;
  }
  return StyleSheet.create(scaled as T);
}
