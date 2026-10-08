import { dark, light } from "@testcard/theme";

export type ThemePref = "auto" | "light" | "dark";
const THEME_KEY = "tc-theme";
export const THEME_EVENT = "tc-theme-change";
const THEME_ORDER: readonly ThemePref[] = ["auto", "light", "dark"];

/** The stored preference as theme-init.js put it on <html>; "auto" on the server and when nothing is set. */
export function readPref(doc: Document = document): ThemePref {
  const v = doc.documentElement.getAttribute("data-theme-pref");
  return v === "light" || v === "dark" ? v : "auto";
}

/** Page backgrounds, as in index.html and @testcard/theme. The browser UI colour follows the chosen theme, not only the system's. */
const THEME_COLOURS = { light: light.background!, dark: dark.background } as const;

/** Explicit choice: every theme-color meta takes that colour. Auto: each goes back to the colour of its own media query. */
export function paintThemeColour(doc: Document, pref: ThemePref): void {
  doc.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    const own = /light/.test(m.getAttribute("media") ?? "") ? "light" : "dark";
    m.setAttribute("content", THEME_COLOURS[pref === "auto" ? own : pref]);
  });
}

export const nextPref = (p: ThemePref): ThemePref => THEME_ORDER[(THEME_ORDER.indexOf(p) + 1) % THEME_ORDER.length] ?? "auto";

/** Apply and remember a preference. Storage may be blocked (private windows, site data off); the choice still applies for this page. */
export function setPref(pref: ThemePref, win: Window = window): void {
  const root = win.document.documentElement;
  root.setAttribute("data-theme-pref", pref);
  root.setAttribute("data-theme", pref === "auto" ? (win.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : pref);
  paintThemeColour(win.document, pref);
  try {
    if (pref === "auto") win.localStorage.removeItem(THEME_KEY);
    else win.localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Not remembered; fine.
  }
  win.dispatchEvent(new Event(THEME_EVENT));
}
