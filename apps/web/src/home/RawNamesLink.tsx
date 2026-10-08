import type { MouseEvent } from "react";
import { RAW_NAMES_EVENT, RAW_NAMES_QUERY } from "../demo/events.ts";

/** Opens the guide with names as the source sends them. Without script it still works as a link. */
export function RawNamesLink({ children }: { children: string }) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const guide = document.getElementById("guide");
    if (!guide) return;
    e.preventDefault();
    window.dispatchEvent(new Event(RAW_NAMES_EVENT));
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    guide.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
  };
  return <a href={`/?${RAW_NAMES_QUERY}=raw#guide`} onClick={go}>{children}</a>;
}
