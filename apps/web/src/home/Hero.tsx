import { Link } from "@tanstack/react-router";
import { DemoSlot } from "../demo/DemoSlot.tsx";
import "./home.css";
import { WaitlistLink } from "../components/WaitlistLink.tsx";

export function Hero() {
  return (
    <>
      <section className="hm-hero" aria-labelledby="hm-h1">
        <div className="wrap hm-hero-grid">
          <h1 id="hm-h1">
            <span className="eyebrow">Testcard IPTV player · Windows · Fire TV</span>
            {" "}The guide is the page.
          </h1>
          <div className="hm-hero-side">
            <p className="lead">
              Add your Xtream or M3U source and your channels arrive tidied, grouped and on a proper programme guide.
            </p>
            <div className="actions">
              <WaitlistLink className="button hm-big" />
              <Link to="/setup" className="button ghost hm-big">How setup works</Link>
            </div>
            <p className="note">Free. We don&rsquo;t sell channels.</p>
          </div>
        </div>
      </section>
      <section id="guide" className="wrap hm-demo" aria-labelledby="dm-label">
        <DemoSlot />
        <p className="note hm-demo-note">Try it: arrows move around, Enter plays, <kbd>/</kbd> searches. Every channel and programme in it is invented.</p>
      </section>
    </>
  );
}
