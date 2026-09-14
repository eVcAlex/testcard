import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const KEY = "testcard:theme";

function read(): Theme {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* private mode / disabled storage — fall through to the default */
  }
  return "dark"; // CONTEXT.md: "a dark, watermark-free player"
}

/** App theme, persisted per-machine. Sets `data-theme` on <html> so tokens.css can switch. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    try {
      window.localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle };
}
