import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Guide } from "./Guide.tsx";
import { RAW_NAMES_EVENT, RAW_NAMES_QUERY } from "./events.ts";
import { initialState } from "./state.ts";

// The interactive guide is its own chunk. Until it arrives (or without JavaScript) the page shows the same guide,
// server-rendered from the initial state, so nothing jumps when it takes over.
const Demo = lazy(() => import("./Demo.tsx"));

const idle = (fn: () => void) => {
  if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 200);
};

export function DemoSlot() {
  const host = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [raw, setRaw] = useState({ initial: false, token: 0 });

  useEffect(() => {
    const arm = () => setArmed(true);
    if (new URLSearchParams(location.search).get(RAW_NAMES_QUERY) === "raw") {
      setRaw({ initial: true, token: 0 });
      arm();
    }
    const onRaw = () => { setRaw((r) => ({ initial: true, token: r.token + 1 })); arm(); };
    window.addEventListener(RAW_NAMES_EVENT, onRaw);

    const el = host.current;
    const events = ["pointerdown", "focusin", "keydown"] as const;
    events.forEach((n) => el?.addEventListener(n, arm, { once: true, capture: true }));
    let io: IntersectionObserver | undefined;
    if (el && typeof IntersectionObserver === "function") {
      io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io?.disconnect(); idle(arm); } }, { rootMargin: "300px" });
      io.observe(el);
    } else idle(arm);
    return () => {
      window.removeEventListener(RAW_NAMES_EVENT, onRaw);
      events.forEach((n) => el?.removeEventListener(n, arm, { capture: true }));
      io?.disconnect();
    };
  }, []);

  const fallback = <Guide state={initialState({ showRawNames: raw.initial })} expanded={false} />;
  return (
    <div ref={host}>
      {armed ? <Suspense fallback={fallback}><Demo initialRaw={raw.initial} rawToken={raw.token} /></Suspense> : fallback}
    </div>
  );
}
