import { Link } from "@tanstack/react-router";
import { useScene } from "../ui/motion.ts";
import { Arrow, Br } from "../ui/parts.tsx";
import { SHOTS } from "./shots.ts";

/** A sticky frame that swaps the screen as each numbered item scrolls past. Without motion, each item carries its own image. */
export function OnScreen() {
  const ref = useScene<HTMLElement>(({ gsap, ScrollTrigger }, root) => {
    const imgs = gsap.utils.toArray<HTMLElement>(".osf-img", root);
    let z = 2;
    let cur = 0;
    const show = (i: number) => {
      const img = imgs[i];
      if (i === cur || !img) return;
      cur = i;
      gsap.set(img, { zIndex: ++z });
      gsap.fromTo(img, { clipPath: "inset(100% 0% 0% 0%)", scale: 1.18 }, { clipPath: "inset(0% 0% 0% 0%)", scale: 1, duration: 0.8, ease: "power3.out", overwrite: true });
    };
    gsap.utils.toArray<HTMLElement>(".os-item", root).forEach((el, i) => {
      ScrollTrigger.create({ trigger: el, start: "top 55%", end: "bottom 55%", onToggle: (s) => s.isActive && show(i) });
    });
  });
  return (
    <section className="onscreen" ref={ref} aria-labelledby="os-h">
      <div className="os-head wrap">
        <h2 className="giant split" id="os-h">On screen.</h2>
        <Br>The real apps</Br>
      </div>
      <p className="os-note wrap">Real screenshots of the Windows and Fire TV apps. The films shown are open movies and public-domain classics, loaded from a demo source.</p>
      <div className="os-grid wrap">
        <div className="os-col">
          <div className="os-frame">
            {SHOTS.map((s) => <img key={s.src} className="osf-img" src={s.src} alt="" width={s.width} height={s.height} loading="lazy" decoding="async" />)}
            <Link to="/features" className="chip-b">See what it does <Arrow dir="right" /></Link>
          </div>
        </div>
        <ol className="os-list">
          {SHOTS.map((s, i) => (
            <li className="os-item" key={s.src}>
              <p className="os-n" aria-hidden="true">{i + 1}</p>
              <h3>{s.title}</h3>
              <img className="os-inline" src={s.src} alt={s.alt} width={s.width} height={s.height} loading="lazy" decoding="async" />
              <p className="os-tags">{s.tags}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
