// Adapted from React Bits DecryptedText (https://reactbits.dev/text-animations/decrypted-text), reduced to the one mode
// the site uses: when the text scrolls into view, its characters settle one at a time from a scramble. The real text is
// always in the DOM for screen readers, and is what shows until (and unless) the animation runs.
import { useEffect, useRef, useState } from "react";
import { animated } from "./motion.ts";

interface Props {
  text: string;
  characters: string;
  speed?: number;
  className?: string;
  encryptedClassName?: string;
}

export function DecryptedText({ text, characters, speed = 70, className, encryptedClassName }: Props) {
  const box = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);
  const [done, setDone] = useState(text.length); // letters settled so far; text.length once finished or never started

  useEffect(() => {
    const el = box.current;
    if (!el || !animated() || typeof IntersectionObserver === "undefined") return;
    const pool = characters.split("");
    let timer = 0;
    const run = () => {
      let n = 0;
      const tick = () => {
        n += 1;
        setDone(n);
        setShown([...text].map((c, i) => (c === " " || i < n ? c : pool[Math.floor(Math.random() * pool.length)] ?? c)).join(""));
        if (n < text.length) timer = window.setTimeout(tick, speed);
      };
      setDone(0);
      tick();
    };
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { io.disconnect(); run(); }
    }, { threshold: 0.1 });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(timer); };
  }, [text, characters, speed]);

  return (
    <span ref={box} aria-hidden="true">
      {[...shown].map((c, i) => <span key={i} className={i < done || done >= text.length ? className : encryptedClassName}>{c}</span>)}
    </span>
  );
}
