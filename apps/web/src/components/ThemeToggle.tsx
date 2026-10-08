import { useSyncExternalStore } from "react";
import { THEME_EVENT, type ThemePref, nextPref, readPref, setPref } from "../theme.ts";

const LABEL: Record<ThemePref, string> = { auto: "system", light: "light", dark: "dark" };

const subscribe = (cb: () => void) => {
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
};

/** One button that cycles system, light, dark. The icon follows html[data-theme-pref] in CSS, so server and client markup match. */
export function ThemeToggle() {
  const pref = useSyncExternalStore(subscribe, () => readPref(), () => "auto" as const);
  return (
    <button type="button" className="icon-btn" onClick={() => setPref(nextPref(pref))} aria-label={`Colour theme: ${LABEL[pref]}. Activate to switch to ${LABEL[nextPref(pref)]}.`}>
      <svg className="ti ti-auto" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" /><path d="M7 16.5h6M10 13.5v3" />
      </svg>
      <svg className="ti ti-light" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="10" cy="10" r="3.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
      </svg>
      <svg className="ti ti-dark" viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16.5 11.8A6.5 6.5 0 0 1 8.2 3.5a6.5 6.5 0 1 0 8.3 8.3Z" />
      </svg>
    </button>
  );
}
