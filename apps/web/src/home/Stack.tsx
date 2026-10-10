import { DecryptedText } from "../ui/DecryptedText.tsx";
import { useScene } from "../ui/motion.ts";
import { Arrow, Br, Disc } from "../ui/parts.tsx";

const MESSY = "UK| ʙʙᴄ ᴏɴᴇ ᴴᴰ";
const CARDS = [
  { k: "Tidy names", s: "Every channel list", body: "Providers send channel names full of odd symbols. Testcard tidies them, so the list is easy to read.", names: true },
  { k: "Keeps playing", s: "Backup feeds", body: "If a channel stops working, Testcard tries that channel’s other feeds and picture qualities for you." },
  { k: "PC and TV in step", s: "One account", body: "One account keeps your sources, favourites and where you left off the same on your computer and your TV." },
];

/** The giant words stay put; each card slides up and lands a little lower than the last. Without motion the cards just list. */
export function Stack() {
  const ref = useScene<HTMLElement>(({ gsap }, root) => {
    const cards = gsap.utils.toArray<HTMLElement>(".scard", root);
    const off = (i: number) => (i - (cards.length - 1) / 2) * 44;
    const tl = gsap.timeline({ scrollTrigger: { trigger: root, start: "top top", end: "bottom bottom", scrub: true, invalidateOnRefresh: true } });
    tl.to({}, { duration: 0.35 });
    cards.forEach((c, i) => {
      tl.fromTo(c, { y: () => innerHeight * 0.8 + 60 }, { y: off(i), ease: "power2.out", duration: 1 }, ">-0.1");
      if (i) tl.to(cards.slice(0, i), { filter: "brightness(.62)", duration: 0.6, ease: "none" }, "<+0.3");
    });
    tl.to({}, { duration: 0.45 });
  });
  return (
    <section className="stack" ref={ref} aria-labelledby="stack-h">
      <div className="stack-pin">
        <Br className="stack-br">Why it feels easy</Br>
        <h2 className="stack-big" id="stack-h"><span>Just</span> <span>press</span> <span>play</span></h2>
        <div className="scards">
          {CARDS.map((c, i) => (
            <article className="scard" key={c.k} aria-labelledby={`sc${i}`}>
              <p className="sc-n" aria-hidden="true">{i + 1}</p>
              <p className="sc-body">{c.body}</p>
              {c.names && (
                <p className="sc-names">
                  <span className="mess" lang="und">{MESSY}</span>
                  <Arrow dir="right" />
                  <span className="sr-only">becomes BBC One HD</span>
                  <span className="clean" aria-hidden="true">
                    <DecryptedText text="BBC One HD" speed={70} characters="ʙᴄᴏɴᴇᴴᴰ|ᵁᴷ" encryptedClassName="enc" />
                  </span>
                </p>
              )}
              <footer className="sc-foot"><Disc /><span><strong id={`sc${i}`}>{c.k}</strong><small>{c.s}</small></span></footer>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
