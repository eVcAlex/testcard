import { dark, tv } from "./colors.ts";

export { dark, light, tv } from "./colors.ts";
export { cssFor } from "./css.ts";

const tvPalette = { ...dark, ...tv };

/** The palette in the shape `apps/mobile/src/theme.ts` has always exposed (hex strings for React Native). */
export const tvColors = {
  background: tvPalette.background,
  sunken: tvPalette["surface-sunken"],
  raised: tvPalette["surface-raised"],
  card: tvPalette.card,
  cardActive: tvPalette["card-active"],
  border: tvPalette.border,
  foreground: tvPalette.foreground,
  muted: tvPalette["muted-foreground"],
  faint: tvPalette["faint-foreground"],
  accent: tvPalette.accent,
  accentInk: tvPalette["accent-foreground"],
  accentSoft: `${tvPalette.accent}26`,
  fault: tvPalette.fault,
  live: tvPalette.live,
} as const;
