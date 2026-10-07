/** Every colour in Testcard. CSS custom-property names without the leading `--`. Edit here, then `pnpm --filter @testcard/theme generate`. */
export const dark = {
  picture: "#000000",
  background: "#14171a",
  "surface-sunken": "#0f1214",
  "surface-raised": "#1a1d21",
  card: "#1c2024",
  "card-hover": "#232830",
  "card-active": "#2b3138",
  scrim: "#05080bcc",
  border: "#262c31",
  "border-strong": "#343c43",
  foreground: "#f2eee7",
  "muted-foreground": "#949ca4",
  "faint-foreground": "#69727a",
  accent: "#e7d2ad",
  "accent-foreground": "#1d160a",
  live: "#e8402a",
  fault: "#f0745c",
} as const;

export const light: Partial<Record<keyof typeof dark, string>> = {
  background: "#f7f8f9",
  "surface-sunken": "#eceff1",
  "surface-raised": "#f0f2f4",
  card: "#ffffff",
  "card-hover": "#f2f4f6",
  "card-active": "#e8ecef",
  border: "#e3e7ea",
  "border-strong": "#cfd6db",
  foreground: "#14181b",
  "muted-foreground": "#5b6670",
  "faint-foreground": "#8d99a2",
  accent: "#7d5f22",
  "accent-foreground": "#ffffff",
  fault: "#b4321c",
};

/** A TV is watched in a dark room from a sofa: deeper neutrals, everything else shared. */
export const tv: Partial<Record<keyof typeof dark, string>> = {
  background: "#0a0d11",
  "surface-sunken": "#07090c",
  "surface-raised": "#12161b",
  card: "#171c22",
  "card-active": "#232a32",
  border: "#252c34",
};
