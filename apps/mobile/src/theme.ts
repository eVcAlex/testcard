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
