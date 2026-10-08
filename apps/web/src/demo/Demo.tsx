import { useEffect, useReducer, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { COLLAPSED_ROWS, channelById } from "./data.ts";
import { Guide, LIST_ID, SEARCH_ID } from "./Guide.tsx";
import { PreviewCanvas } from "./PreviewCanvas.tsx";
import { initialState, reducer, visibleChannels } from "./state.ts";

export const TICK_MS = 4000;
const prefersReducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The interactive guide. Only ever rendered on the client, after the page is up, so it may read the window. */
export default function Demo({ initialRaw = false, rawToken = 0 }: { initialRaw?: boolean; rawToken?: number }) {
  const [state, dispatch] = useReducer(reducer, { showRawNames: initialRaw }, initialState);
  const [expanded, setExpanded] = useState(false);
  const [reduced] = useState(prefersReducedMotion);
  const root = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"row" | `tab:${string}` | null>(null);

  const focusRow = () => {
    const row = root.current?.querySelector<HTMLElement>(`#${LIST_ID} [role="option"][tabindex="0"]`);
    row?.focus();
    return !!row;
  };
  const focusTab = (id: string) => {
    const tab = root.current?.querySelector<HTMLElement>(`#dm-tab-${id}`);
    tab?.focus();
    return !!tab;
  };

  // Move DOM focus after the render that changed the roving tab stop.
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    if (p === "row" ? focusRow() : focusTab(p.slice(4))) pendingFocus.current = null;
  });

  // The fake clock. Paused under reduced motion and while the tab is hidden.
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => { if (!document.hidden) dispatch({ type: "tick" }); }, TICK_MS);
    return () => clearInterval(id);
  }, [reduced]);

  useEffect(() => { if (rawToken) dispatch({ type: "setRaw", value: true }); }, [rawToken]);

  // Narrow screens show the first rows only; keyboard focus past them opens the rest.
  useEffect(() => {
    const i = visibleChannels(state).findIndex((c) => c.id === state.focus.channelId);
    if (i >= COLLAPSED_ROWS) setExpanded(true);
  }, [state]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    const k = e.key;
    const typing = t.tagName === "INPUT";

    if (k === "Escape") {
      e.preventDefault();
      // Only wait for a re-render when the list is about to change; otherwise a stale request would pull focus out of the search box on the next keystroke.
      if (state.query) {
        dispatch({ type: "setQuery", query: "" });
        pendingFocus.current = "row";
      }
      focusRow();
      return;
    }
    if (typing) {
      pendingFocus.current = null;
      if (k === "ArrowDown") { e.preventDefault(); focusRow(); }
      return;
    }
    if (k === "/") {
      e.preventDefault();
      const input = root.current?.querySelector<HTMLInputElement>(`#${SEARCH_ID}`);
      input?.focus();
      input?.select();
      return;
    }
    const row = t.closest<HTMLElement>('[role="option"]');
    if (k === "t" || k === "T") { dispatch({ type: "toggleTv" }); return; }
    if (k === "f" || k === "F") { dispatch({ type: "toggleFavourite", channelId: row?.dataset.id ?? state.focus.channelId }); return; }

    if (t.getAttribute("role") === "tab") {
      const ids = [...(root.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].map((el) => el.dataset.k!);
      const i = ids.indexOf(t.dataset.k!);
      const n = k === "ArrowDown" || k === "ArrowRight" ? (i + 1) % ids.length : k === "ArrowUp" || k === "ArrowLeft" ? (i - 1 + ids.length) % ids.length : k === "Home" ? 0 : k === "End" ? ids.length - 1 : -1;
      if (n >= 0) {
        e.preventDefault();
        const id = ids[n]!;
        dispatch({ type: "setCategory", category: id as never });
        pendingFocus.current = `tab:${id}`;
        focusTab(id);
      }
      return;
    }
    if (row) {
      if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault(); dispatch({ type: "moveFocus", delta: k === "ArrowDown" ? 1 : -1 }); pendingFocus.current = "row"; }
      else if (k === "Home" || k === "End") { e.preventDefault(); dispatch({ type: "focusEdge", edge: k === "Home" ? "first" : "last" }); pendingFocus.current = "row"; }
      else if (k === "ArrowRight" || k === "ArrowLeft") { e.preventDefault(); dispatch({ type: "moveSlot", delta: k === "ArrowRight" ? 1 : -1 }); }
      else if (k === "Enter" || k === " ") { e.preventDefault(); dispatch({ type: "play", channelId: row.dataset.id! }); }
    }
  };

  return (
    <Guide
      state={state}
      dispatch={dispatch}
      expanded={expanded}
      onExpand={() => setExpanded(true)}
      rootRef={root}
      onKeyDown={onKeyDown}
      canvas={<PreviewCanvas channel={channelById(state.playing)} firstTuneMs={reduced ? 0 : 600} tuneMs={reduced ? 0 : 300} />}
    />
  );
}
