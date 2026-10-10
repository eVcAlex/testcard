import { useScene } from "../ui/motion.ts";
import { Arrow } from "../ui/parts.tsx";
import { TV_GUIDE } from "./shots.ts";

export function Hero() {
  // the picture sinks slower than the page, and the words leave a little faster
  const ref = useScene<HTMLElement>(({ gsap }, root) => {
    const st = { trigger: root, start: "top top", end: "bottom top", scrub: true };
    gsap.to(".hero-bg", { yPercent: 18, ease: "none", scrollTrigger: st });
    gsap.to(".hero-h", { yPercent: -14, ease: "none", scrollTrigger: st });
  });
  return (
    <section className="hero" ref={ref}>
      <div className="hero-bg" aria-hidden="true">
        <img src={TV_GUIDE.src} alt="" width={TV_GUIDE.width} height={TV_GUIDE.height} fetchPriority="high" decoding="async" />
      </div>
      <h1 className="hero-h" tabIndex={-1}>
        <span className="sr-only">Testcard IPTV player. </span>
        <span className="hl hl1">
          <span className="ln"><span className="ln-i i0">Live TV,</span></span>
          <span className="tile" aria-hidden="true"><span>Windows +<br />Fire TV</span></span>
        </span>{" "}
        <span className="hl hl2"><span className="ln"><span className="ln-i i1">films &amp;</span></span></span>{" "}
        <span className="hl hl3">
          <span className="ln"><span className="ln-i i2">series</span></span>
          <span className="tile" aria-hidden="true"><span>Your own<br />channels</span></span>
          <span className="ln" aria-hidden="true"><span className="ln-i i3"><Arrow /></span></span>
        </span>
      </h1>
      <div className="hero-p intro">
        <p>Testcard is a player for Windows and Fire TV. You bring the channels from your provider; it makes them easy to watch.</p>
      </div>
      <p className="corner c-bl intro">Please stand by</p>
      <p className="corner c-br intro" aria-hidden="true">Scroll</p>
    </section>
  );
}
