import { useEffect, useRef } from "react";

export type Engine = typeof import("./engine.ts");

let loading: Promise<Engine> | undefined;
/** Loads GSAP and Lenis once. Nothing on the page needs them to be readable; they only add motion. */
export const engine = (): Promise<Engine> =>
  (loading ??= import("./engine.ts").catch((err) => {
    // No motion layer (offline, blocked): fall back to the calm layout rather than leave pinned sections empty.
    document.documentElement.classList.remove("anim");
    throw err;
  }));

/** Runs `fn` once the engine has loaded; if it never does, the page stays on the calm layout and nothing is thrown. */
export const whenEngine = (fn: (e: Engine) => void): void => void engine().then(fn, () => {});

/** The stylesheet and theme-init.js decide the same thing: no script, or reduced motion, means the calm layout. */
export const animated = () => typeof document !== "undefined" && document.documentElement.classList.contains("anim");

/**
 * A scroll scene bound to one element: `setup` runs once GSAP has loaded, inside a gsap.context scoped to the element,
 * and everything it made is reverted when the component unmounts. Does nothing on the calm layout.
 */
export function useScene<T extends HTMLElement>(setup: (e: Engine, root: T) => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!animated()) return;
    let dead = false;
    let ctx: { revert(): void } | undefined;
    whenEngine((e) => {
      const root = ref.current;
      if (dead || !root) return;
      ctx = e.gsap.context(() => setup(e, root), root);
      e.ScrollTrigger.refresh();
    });
    return () => {
      dead = true;
      ctx?.revert();
    };
    // setup is a fresh closure every render and is meant to run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}
