import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { animated, engine, whenEngine } from "./motion.ts";

/**
 * Everything that makes the site move and that is not tied to one section: smooth scrolling, the square cursor, the
 * grow-to-fill page change, and the heading and block reveals of the inner pages. All of it is decoration on top of
 * markup that already reads and works without it, and it does nothing on the calm layout (see html.anim).
 */
export function Effects() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pointer = useRef({ x: 0, y: 0 });
  const covering = useRef(false);
  const first = useRef(true);

  // Smooth scroll.
  useEffect(() => {
    if (!animated()) return;
    whenEngine((e) => e.startLenis());
  }, []);

  // The square cursor trails the pointer; the system cursor stays.
  useEffect(() => {
    if (!animated()) return;
    const track = (e: PointerEvent) => { pointer.current = { x: e.clientX, y: e.clientY }; };
    addEventListener("pointermove", track, { passive: true });
    let cleanup = () => removeEventListener("pointermove", track);
    if (animated() && matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const sq = document.querySelector<HTMLElement>(".cur");
      if (sq) {
        let dead = false;
        whenEngine(({ gsap }) => {
          if (dead) return;
          const x = gsap.quickTo(sq, "x", { duration: 0.35, ease: "power3" });
          const y = gsap.quickTo(sq, "y", { duration: 0.35, ease: "power3" });
          let on = false;
          let hot = false;
          const move = (e: PointerEvent) => {
            if (!on) { on = true; gsap.set(sq, { x: e.clientX, y: e.clientY }); gsap.to(sq, { opacity: 1, duration: 0.3 }); }
            x(e.clientX); y(e.clientY);
            const h = !!(e.target as Element).closest?.("a, button, input, label, summary");
            if (h !== hot) { hot = h; gsap.to(sq, { scale: h ? 1.8 : 1, duration: 0.35, ease: "power3.out" }); }
          };
          const leave = () => { on = false; gsap.to(sq, { opacity: 0, duration: 0.2 }); };
          addEventListener("pointermove", move, { passive: true });
          document.documentElement.addEventListener("pointerleave", leave);
          const prev = cleanup;
          cleanup = () => { prev(); removeEventListener("pointermove", move); document.documentElement.removeEventListener("pointerleave", leave); };
        });
        const prev = cleanup;
        cleanup = () => { dead = true; prev(); };
      }
    }
    return () => cleanup();
  }, []);

  // A click on an in-app link grows the square to fill the screen; the route changes behind it.
  useEffect(() => {
    if (!animated()) return;
    const onClick = (ev: MouseEvent) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const a = (ev.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname) return;
      if (/\.[a-z0-9]+$/i.test(url.pathname) || url.pathname.startsWith("/app/")) return; // a file (installer, licence), not a route
      if (covering.current) { ev.preventDefault(); ev.stopPropagation(); return; }
      ev.preventDefault();
      ev.stopPropagation();
      covering.current = true;
      const at = ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : pointer.current;
      void engine().then(({ gsap }) => {
        const half = Math.max(at.x, innerWidth - at.x, at.y, innerHeight - at.y);
        gsap.timeline({ onComplete: () => router.history.push(url.pathname + url.search + url.hash) })
          .set(".wipe", { visibility: "visible", left: at.x - 12, top: at.y - 12 })
          .fromTo(".wipe", { scale: 0.2 }, { scale: (half * 2 + 60) / 24, duration: 0.55, ease: "power3.in" });
      }).catch(() => {
        covering.current = false;
        router.history.push(url.pathname + url.search + url.hash);
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  // On every route: reveal the page, then reveal its headings and blocks.
  useEffect(() => {
    const intro = first.current && !document.documentElement.classList.contains("no-intro");
    first.current = false;
    if (!animated()) return;
    let dead = false;
    let ctx: { revert(): void } | undefined;
    whenEngine(({ gsap, ScrollTrigger, SplitText, resetScroll }) => {
      if (dead) return;
      const main = document.getElementById("main");
      if (!main) return;
      if (covering.current) {
        covering.current = false;
        resetScroll();
        gsap.to(".wipe", { scale: 0, duration: 0.6, ease: "power3.out", onComplete: () => { gsap.set(".wipe", { visibility: "hidden" }); } });
      }
      const delay = intro ? 1.3 : 0.2;
      ctx = gsap.context(() => {
        main.querySelectorAll<HTMLElement>(".split").forEach((h) => {
          const s = SplitText.create(h, { type: "chars,words", mask: "chars" });
          h.classList.add("is-split");
          gsap.from(s.chars, { yPercent: 110, duration: 0.9, stagger: 0.025, ease: "power4.out", delay: h.tagName === "H1" ? delay : 0, scrollTrigger: { trigger: h, start: "top 92%", once: true } });
        });
        const rise = Array.from(main.querySelectorAll<HTMLElement>("[data-rise], .meta > div"));
        rise.forEach((el) => el.classList.add("is-set"));
        if (!rise.length) return;
        gsap.set(rise, { opacity: 0, y: 30 });
        ScrollTrigger.batch(rise, { start: "top 96%", once: true, onEnter: (b) => gsap.to(b, { opacity: 1, y: 0, duration: 0.8, stagger: 0.07, ease: "power3.out", delay: delay * 0.6 }) });
      }, main);
      ScrollTrigger.refresh();
    });
    return () => { dead = true; ctx?.revert(); };
  }, [pathname]);

  return (
    <>
      <div className="cur" aria-hidden="true" />
      <div className="wipe" aria-hidden="true" />
    </>
  );
}
