// The motion layer: GSAP (with ScrollTrigger, SplitText, Flip) and Lenis. Browser only, and loaded on demand by
// motion.ts after the page has painted, so the prerendered HTML never waits for it.
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger, SplitText, Flip);

let lenis: Lenis | undefined;

/** Smooth scrolling, driven by GSAP's ticker so ScrollTrigger and Lenis share one clock. Idempotent. */
export function startLenis(): Lenis {
  if (lenis) return lenis;
  lenis = new Lenis({ lerp: 0.1 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis?.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

export const getLenis = () => lenis;

/** Jump to the top without animating (route changes). */
export function resetScroll(): void {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  window.scrollTo(0, 0);
}

export { Flip, ScrollTrigger, SplitText, gsap };
