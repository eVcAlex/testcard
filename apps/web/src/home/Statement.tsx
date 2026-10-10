import { useRef } from "react";
import { ScrollReveal } from "../ui/ScrollReveal.tsx";
import { useScene } from "../ui/motion.ts";
import { Br } from "../ui/parts.tsx";
import { DESKTOP_LIVE, DESKTOP_MOVIES, TV_GUIDE, TV_MOVIES } from "./shots.ts";

const FLOATS = [TV_MOVIES, DESKTOP_LIVE, TV_GUIDE, DESKTOP_MOVIES];

/** A sticky statement whose words light up as you scroll, while the real screens drift up past it at their own pace. */
export function Statement() {
  const sec = useRef<HTMLElement | null>(null);
  const scene = useScene<HTMLElement>(({ gsap }, root) => {
    const tl = gsap.timeline({ scrollTrigger: { trigger: root, start: "top bottom", end: "bottom top", scrub: true, invalidateOnRefresh: true } });
    gsap.utils.toArray<HTMLElement>(".fl", root).forEach((el, i) => {
      gsap.set(el, { autoAlpha: 1 });
      tl.fromTo(el, { y: () => innerHeight * 1.05 }, { y: () => -innerHeight * 0.9 - el.offsetHeight, ease: "none", duration: 1.4 + (i % 2) * 0.35 }, i * 0.42);
    });
  });
  return (
    <section className="what" ref={(el) => { sec.current = el; scene.current = el; }} aria-labelledby="what-h">
      <div className="what-pin wrap">
        <Br>What it does</Br>
        <div>
          <ScrollReveal as="h2" id="what-h" className="what-h" trigger={sec} start="top 35%" end="center 45%" baseOpacity={0.16}>
            Your channels, films and series, tidied into one calm place on your computer and your TV.
          </ScrollReveal>
          <p className="what-sub">You add your own channels. Testcard makes them easy to watch.</p>
        </div>
        <div className="floats" aria-hidden="true">
          {FLOATS.map((s, i) => <img key={s.src} className={`fl fl${i}`} src={s.src} alt="" width={s.width} height={s.height} loading="lazy" decoding="async" />)}
        </div>
      </div>
    </section>
  );
}
