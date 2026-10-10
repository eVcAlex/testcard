import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { WaitlistLink } from "../components/WaitlistLink.tsx";
import { DESKTOP_LIVE, DESKTOP_MOVIES, type Shot, TV_GUIDE, TV_MOVIES } from "../home/shots.ts";
import { RELEASE_STATE } from "../site.ts";
import { type Engine, animated, whenEngine } from "../ui/motion.ts";
import { BackChip, Br } from "../ui/parts.tsx";

interface Feature { title: string; tag: string; body: string; shot?: Shot; panel?: ReactNode }

const FEATURES: readonly Feature[] = [
  {
    title: "Your channels, tidied", tag: "Bring your own",
    body: "Testcard brings no channels. Add the playlist link (called M3U) or the login (called Xtream Codes) from your provider, and it tidies the messy names.",
    panel: <div className="pn pn-names"><span lang="und">UK| ʙʙᴄ ᴏɴᴇ ᴴᴰ</span><b>BBC One HD</b></div>,
  },
  { title: "TV guide", tag: "Now, next, catch-up", body: "See what is on now and next on every channel. Missed something? Catch-up plays it back, if your provider keeps an archive.", shot: TV_GUIDE },
  { title: "Films & series", tag: "On shelves", body: "Films and series from your provider sit next to live TV, sorted onto shelves.", shot: DESKTOP_MOVIES },
  {
    title: "One account", tag: "PC and TV in step",
    body: "One account keeps your sources, favourites and where you left off the same on your computer and your TV.",
    panel: <div className="pn pn-sync"><b>PC</b><span aria-hidden="true">⇄</span><b>TV</b></div>,
  },
  {
    title: "Keeps playing", tag: "Backup feeds",
    body: "If a channel stops working, Testcard tries that channel’s other feeds and picture qualities for you.",
    panel: (
      <div className="pn pn-feeds"><small>Example</small>
        <p><span>Feed 1</span><em className="no">stopped</em></p>
        <p><span>Feed 2</span><em className="yes">playing</em></p>
      </div>
    ),
  },
  { title: "Made for the remote", tag: "Fire TV", body: "Big, clear screens for the TV remote, with Skip intro and Next episode buttons when you need them.", shot: TV_MOVIES },
  {
    title: "Captions your way", tag: "Fire TV",
    body: "Change how captions look, so they are easy to read from the sofa.",
    panel: <div className="pn pn-cap"><small>Example</small><p>Captions, the size and colour you like.</p></div>,
  },
  { title: "Live TV on your PC", tag: "Windows", body: "Channels, a live preview and the guide side by side on your computer. Still quick with tens of thousands of channels, and both apps keep themselves up to date.", shot: DESKTOP_LIVE },
];

export function Features() {
  const [big, setBig] = useState(-1);
  const flip = useRef<{ Flip: Engine["Flip"]; state: ReturnType<Engine["Flip"]["getState"]> | null } | null>(null);

  useEffect(() => {
    if (!animated()) return;
    let dead = false;
    whenEngine(({ Flip }) => { if (!dead) flip.current = { Flip, state: null }; });
    return () => { dead = true; };
  }, []);

  const toggle = (i: number) => {
    // remember where every frame is, change the grid, and let each one glide to its new place
    if (flip.current) flip.current.state = flip.current.Flip.getState(".ftile");
    setBig((b) => (b === i ? -1 : i));
  };
  useLayoutEffect(() => {
    const f = flip.current;
    if (!f?.state) return;
    const state = f.state;
    f.state = null;
    f.Flip.from(state, { duration: 0.75, ease: "power3.inOut", nested: true });
  }, [big]);

  return (
    <section className="page-in wrap features">
      <BackChip />
      <div className="phead">
        <h1 className="giant split" tabIndex={-1}>What it does.</h1>
        <Br>{FEATURES.length} things, in plain words</Br>
      </div>
      <ul className="wall">
        {FEATURES.map((f, i) => (
          <li key={f.title} className={`ftile c${(i % 6) + 2}${big === i ? " big" : ""}`} data-flip-id={`f${i}`} data-rise>
            <div className="frame">
              {f.shot ? <img src={f.shot.src} alt={f.shot.alt} width={f.shot.width} height={f.shot.height} loading="lazy" decoding="async" /> : f.panel}
              {f.shot && (
                <button type="button" className="enl" aria-pressed={big === i} onClick={() => toggle(i)}>
                  {big === i ? "Smaller" : "Enlarge"}<span className="sr-only"> picture: {f.title}</span>
                </button>
              )}
            </div>
            <div className="ftxt">
              <p className="fn" aria-hidden="true">{String(i + 1).padStart(2, "0")}</p>
              <div>
                <h2>{f.title}</h2>
                <p className="ftag">{f.tag}</p>
                <p className="fbody">{f.body}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="btns f-end" data-rise>
        {RELEASE_STATE === "waitlist" ? <WaitlistLink className="btn fill">Join the beta waitlist</WaitlistLink> : <Link to="/download" className="btn fill">Download</Link>}
        <Link to="/setup" className="btn line">How setup works</Link>
        <Link to="/faq" className="btn line">Read the FAQ</Link>
      </div>
    </section>
  );
}
