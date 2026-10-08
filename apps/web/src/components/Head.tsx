import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { applyHead } from "../head.ts";
import { headModel, metaFor } from "../routes-meta.ts";

/** Keeps document title and meta in step with the route. The prerendered head is already right on first load; this handles client navigation. Also moves focus and scroll like a page load would. */
export function Head() {
  const { pathname, hash } = useRouterState({ select: (s) => ({ pathname: s.location.pathname, hash: s.location.hash }) });
  const first = useRef(true);

  useEffect(() => {
    // The prerendered head (JSON-LD included) is already right on first load; only the dev shell has none.
    if (first.current && document.head.querySelector("[data-head]")) { first.current = false; return; }
    applyHead(document, headModel(metaFor(pathname)));
    if (first.current) { first.current = false; return; }
    const target = hash ? document.getElementById(hash) : null;
    if (target) { target.scrollIntoView(); return; }
    window.scrollTo(0, 0);
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [pathname, hash]);

  return null;
}
