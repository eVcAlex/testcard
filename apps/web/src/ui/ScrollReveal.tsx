// Adapted from React Bits ScrollReveal (https://reactbits.dev/text-animations/scroll-reveal):
// words light up from a low opacity as you scroll. Differences: it cleans up only its own tweens (the original kills every
// ScrollTrigger on the page, which breaks route changes), takes the trigger element as a prop so a sticky statement can be
// driven by its tall parent, and renders the element you ask for. Without the motion layer it is plain readable text.
import type { RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import { animated, whenEngine } from "./motion.ts";

interface Props {
  children: string;
  as?: "h2" | "p";
  id?: string;
  className?: string;
  trigger?: RefObject<HTMLElement | null>;
  start?: string;
  end?: string;
  baseOpacity?: number;
}

export function ScrollReveal({ children, as: T = "p", id, className = "", trigger, start = "top bottom-=20%", end = "bottom bottom", baseOpacity = 0.1 }: Props) {
  const ref = useRef<HTMLElement>(null);
  const words = useMemo(() => children.split(/(\s+)/).map((w, i) => (/^\s+$/.test(w) ? w : <span className="word" key={i}>{w}</span>)), [children]);
  useEffect(() => {
    if (!animated()) return;
    let dead = false;
    let ctx: { revert(): void } | undefined;
    whenEngine(({ gsap }) => {
      const el = ref.current;
      if (dead || !el) return;
      ctx = gsap.context(() => {
        gsap.fromTo(el.querySelectorAll(".word"), { opacity: baseOpacity }, {
          opacity: 1, stagger: 0.05, ease: "none",
          scrollTrigger: { trigger: trigger?.current || el, start, end, scrub: true },
        });
      }, el);
    });
    return () => { dead = true; ctx?.revert(); };
  }, [trigger, start, end, baseOpacity]);
  return <T ref={ref as never} id={id} className={`scroll-reveal-text ${className}`.trim()}>{words}</T>;
}
