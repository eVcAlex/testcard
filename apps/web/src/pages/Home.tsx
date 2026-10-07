import { Link } from "@tanstack/react-router";
import { SHOTS } from "../site.ts";

const pairs = [
  ["Every provider names channels differently", "Names are tidied, so lists read the same everywhere."],
  ["Different app on every screen, progress lost", "One account keeps sources, favourites and where you left off across Windows and Fire TV."],
  ["A channel dies and you hunt for another", "Testcard tries the channel's other feeds and qualities for you."],
  ["No guide, or a guide you can't read", "A full TV guide grid with now and next."],
] as const;

const features = [
  ["Bring any source", "Add Xtream Codes or M3U playlists. Live channels, films and series sit together."],
  ["Fast at any size", "Stays quick with tens of thousands of channels."],
  ["Catch up", "Watch shows back from providers that keep an archive."],
  ["Made for the sofa", "A layout built for the remote, with Skip intro and a Next episode button on Fire TV."],
  ["Captions your way", "Restyle subtitles on Fire TV so they read well from the couch."],
  ["Keeps itself current", "Both apps update themselves when a new version is out."],
] as const;

export function Home() {
  return (
    <>
      <section className="hero">
        <h1>Live TV, films and series. Everywhere you watch.</h1>
        <p className="lead">Testcard is a fast, tidy IPTV player for Windows and Fire TV. Bring your own sources and pick up where you left off on any screen.</p>
        <div className="actions">
          <Link to="/download" className="button">Download</Link>
          <Link to="/link" className="button ghost">Link your TV</Link>
        </div>
        <p className="note">Free during early access. Testcard brings no channels: you add your own.</p>
      </section>
      <section className="problem">
        <h2>IPTV, without the mess</h2>
        <ul className="pairs">
          {pairs.map(([problem, answer]) => (
            <li key={problem}><b>{problem}</b><span>{answer}</span></li>
          ))}
        </ul>
      </section>
      <section className="extras">
        <h2>Everything else</h2>
        <div className="features">
        {features.map(([title, text]) => (
          <div className="card" key={title}>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        ))}
      </div>
      </section>
      {SHOTS.length > 0 && (
        <section className="shots">
          <h2>See it</h2>
          {SHOTS.map((s) => (
            <figure key={s.src}>
              <img src={s.src} alt={s.alt} width={s.width} height={s.height} loading="lazy" decoding="async" />
              <figcaption>{s.caption}</figcaption>
            </figure>
          ))}
        </section>
      )}
      <section className="cta">
        <h2>Get Testcard</h2>
        <div className="actions">
          <Link to="/download" className="button">Download</Link>
          <Link to="/link" className="button ghost">Link your TV</Link>
        </div>
      </section>
    </>
  );
}
